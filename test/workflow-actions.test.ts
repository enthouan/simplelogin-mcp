import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  type Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  type Pair,
  parseDocument,
  type YAMLMap,
} from 'yaml';

const workflowsDirectory = new URL('../.github/workflows/', import.meta.url);
const externalReferencePattern = /^([^/@\s]+)\/([^/@\s]+)(?:\/[^@\s]+)*@([^@\s]+)$/;
const immutableCommitPattern = /^[0-9a-f]{40}$/;
const exactVersionPattern =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface ExternalUse {
  action: string;
  commit: string;
  repository: string;
  version: string;
}

interface UsesValidation {
  external?: ExternalUse;
  violation?: string;
}

interface LocatedUse extends UsesValidation {
  line: number;
}

function resolveAlias(node: unknown, document: Document): unknown {
  return isAlias(node) ? node.resolve(document) : node;
}

function scalarString(node: unknown, document: Document): string | undefined {
  const resolved = resolveAlias(node, document);
  return isScalar(resolved) && typeof resolved.value === 'string' ? resolved.value : undefined;
}

function findPair(
  map: YAMLMap<unknown, unknown>,
  key: string,
  document: Document,
): Pair<unknown, unknown> | undefined {
  return map.items.find((pair) => scalarString(pair.key, document) === key);
}

function pairLine(pair: Pair<unknown, unknown>, lineCounter: LineCounter): number {
  const node = isNode(pair.key) ? pair.key : isNode(pair.value) ? pair.value : undefined;
  const offset = node?.range?.[0] ?? 0;
  return lineCounter.linePos(offset).line;
}

function validateUsesPair(
  pair: Pair<unknown, unknown>,
  document: Document,
  container: YAMLMap<unknown, unknown>,
): UsesValidation {
  const reference = scalarString(pair.value, document);
  if (reference === undefined) {
    return { violation: 'uses has a non-string reference' };
  }

  if (reference.startsWith('./') || reference.startsWith('docker://')) {
    return {};
  }

  const external = externalReferencePattern.exec(reference);
  const owner = external?.[1];
  const repositoryName = external?.[2];
  const commit = external?.[3];
  if (owner === undefined || repositoryName === undefined || commit === undefined) {
    return { violation: `has unsupported external reference ${reference}` };
  }

  if (!immutableCommitPattern.test(commit)) {
    return {
      violation: `${reference} is not pinned to a full lowercase commit SHA`,
    };
  }

  const version = isNode(pair.value)
    ? (pair.value.comment?.trim() ?? (container.flow ? container.comment?.trim() : undefined))
    : undefined;
  if (version === undefined || !exactVersionPattern.test(version)) {
    return { violation: `${reference} needs an exact release comment` };
  }

  return {
    external: {
      action: reference.slice(0, reference.lastIndexOf('@')),
      commit,
      repository: `${owner.toLowerCase()}/${repositoryName.toLowerCase()}`,
      version,
    },
  };
}

function scanWorkflow(workflow: string): LocatedUse[] {
  const lineCounter = new LineCounter();
  const document = parseDocument(workflow, {
    lineCounter,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return document.errors.map((error) => ({
      line: error.linePos?.[0].line ?? lineCounter.linePos(error.pos[0]).line ?? 1,
      violation: `invalid YAML: ${error.message}`,
    }));
  }

  const root = resolveAlias(document.contents, document);
  if (!isMap(root)) {
    return [];
  }

  const jobs = resolveAlias(findPair(root, 'jobs', document)?.value, document);
  if (!isMap(jobs)) {
    return [];
  }

  const uses: LocatedUse[] = [];
  const addPair = (pair: Pair<unknown, unknown>, container: YAMLMap<unknown, unknown>): void => {
    uses.push({
      line: pairLine(pair, lineCounter),
      ...validateUsesPair(pair, document, container),
    });
  };

  for (const jobPair of jobs.items) {
    const job = resolveAlias(jobPair.value, document);
    if (!isMap(job)) {
      continue;
    }

    const reusableWorkflow = findPair(job, 'uses', document);
    if (reusableWorkflow !== undefined) {
      addPair(reusableWorkflow, job);
    }

    const steps = resolveAlias(findPair(job, 'steps', document)?.value, document);
    if (!isSeq(steps)) {
      continue;
    }

    for (const stepNode of steps.items) {
      const step = resolveAlias(stepNode, document);
      if (!isMap(step)) {
        continue;
      }

      const action = findPair(step, 'uses', document);
      if (action !== undefined) {
        addPair(action, step);
      }
    }
  }

  return uses;
}

function pinConsistencyViolations(
  external: ExternalUse,
  commitsByRelease: Map<string, string>,
  versionsByCommit: Map<string, string>,
): string[] {
  const violations: string[] = [];
  const release = `${external.repository}@${external.version}`;
  const existingCommit = commitsByRelease.get(release);
  if (existingCommit !== undefined && existingCommit !== external.commit) {
    violations.push(
      `${external.action} uses ${external.commit} # ${external.version}, but ${release} also uses ${existingCommit}`,
    );
  } else {
    commitsByRelease.set(release, external.commit);
  }

  const pinnedCommit = `${external.repository}@${external.commit}`;
  const existingVersion = versionsByCommit.get(pinnedCommit);
  if (existingVersion !== undefined && existingVersion !== external.version) {
    violations.push(
      `${external.action} labels ${external.commit} as ${external.version}, but the same commit is also labeled ${existingVersion}`,
    );
  } else {
    versionsByCommit.set(pinnedCommit, external.version);
  }

  return violations;
}

describe('GitHub workflow action pinning', () => {
  it('pins every external workflow reference consistently', async () => {
    const workflowFiles = (await readdir(workflowsDirectory, { withFileTypes: true }))
      .filter(
        (entry) => entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')),
      )
      .map((entry) => entry.name)
      .sort();
    const violations: string[] = [];
    const commitsByRelease = new Map<string, string>();
    const versionsByCommit = new Map<string, string>();

    for (const filename of workflowFiles) {
      const workflow = await readFile(new URL(filename, workflowsDirectory), 'utf8');
      for (const result of scanWorkflow(workflow)) {
        const location = `.github/workflows/${filename}:${result.line}`;
        if (result.violation !== undefined) {
          violations.push(`${location}: ${result.violation}`);
          continue;
        }

        if (result.external !== undefined) {
          violations.push(
            ...pinConsistencyViolations(result.external, commitsByRelease, versionsByCommit).map(
              (violation) => `${location}: ${violation}`,
            ),
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it.each([
    'actions/checkout@v7',
    'actions/checkout@main',
    'actions/checkout@3d3c42e5',
    'actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1',
  ])('rejects mutable external reference %s', (reference) => {
    expect(
      scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ${reference} # v7.0.1`)[0]?.violation,
    ).toContain('not pinned to a full lowercase commit SHA');
  });

  it.each([undefined, 'v7', 'release v7.0.1'])(
    'rejects incomplete exact-version comment %s',
    (version) => {
      expect(
        scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1${version === undefined ? '' : ` # ${version}`}`)[0]
          ?.violation,
      ).toContain('needs an exact release comment');
    },
  );

  it('rejects malformed and non-string external references', () => {
    expect(
      scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout`)[0]?.violation,
    ).toContain('unsupported external reference');
    expect(
      scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: 123`)[0]?.violation,
    ).toBe('uses has a non-string reference');
  });

  it('finds semantic uses keys across valid YAML styles and aliases', () => {
    expect(
      scanWorkflow(`env:
  KEY: &uses-key uses
x-step: &aliased-step
  uses: docker/setup-qemu-action@v4
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses : actions/checkout@v7
      - "us\\u0065s": actions/setup-node@v7
      - ? *uses-key
        : pnpm/action-setup@v6
      - { uses: docker/setup-buildx-action@v4 }
      - *aliased-step`).map(({ violation }) => violation),
    ).toEqual([
      'actions/checkout@v7 is not pinned to a full lowercase commit SHA',
      'actions/setup-node@v7 is not pinned to a full lowercase commit SHA',
      'pnpm/action-setup@v6 is not pinned to a full lowercase commit SHA',
      'docker/setup-buildx-action@v4 is not pinned to a full lowercase commit SHA',
      'docker/setup-qemu-action@v4 is not pinned to a full lowercase commit SHA',
    ]);
  });

  it('allows local actions, local workflows, and Docker references', () => {
    expect(
      scanWorkflow(`jobs:
  reusable:
    uses: './.github/workflows/reusable.yml' # local workflow
  test:
    runs-on: ubuntu-latest
    steps: [
      { uses: ./.github/actions/setup },
      { uses: "docker://alpine:3.23" }
    ]`),
    ).toEqual([{ line: 3 }, { line: 7 }, { line: 8 }]);
  });

  it('ignores uses-like scalar text and detects a sibling after a block scalar', () => {
    expect(
      scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: 'document uses: syntax'
        run: |
          echo "uses: actions/checkout@v7"
      - name: |
          Checkout source
        uses: actions/checkout@v7`),
    ).toEqual([
      {
        line: 10,
        violation: 'actions/checkout@v7 is not pinned to a full lowercase commit SHA',
      },
    ]);
  });

  it('accepts a pinned external reusable workflow', () => {
    expect(
      scanWorkflow(`jobs:
  check:
    uses: owner/repository/.github/workflows/check.yml@0123456789abcdef0123456789abcdef01234567 # v1.2.3`),
    ).toEqual([
      {
        external: {
          action: 'owner/repository/.github/workflows/check.yml',
          commit: '0123456789abcdef0123456789abcdef01234567',
          repository: 'owner/repository',
          version: 'v1.2.3',
        },
        line: 3,
      },
    ]);
  });

  it('accepts exact release comments after flow mappings', () => {
    expect(
      scanWorkflow(`jobs:
  reusable: { uses: owner/repository/.github/workflows/check.yml@0123456789abcdef0123456789abcdef01234567 } # v1.2.3
  test:
    runs-on: ubuntu-latest
    steps:
      - { uses: owner/repository/action@0123456789abcdef0123456789abcdef01234567 } # v1.2.3`),
    ).toEqual([
      {
        external: {
          action: 'owner/repository/.github/workflows/check.yml',
          commit: '0123456789abcdef0123456789abcdef01234567',
          repository: 'owner/repository',
          version: 'v1.2.3',
        },
        line: 2,
      },
      {
        external: {
          action: 'owner/repository/action',
          commit: '0123456789abcdef0123456789abcdef01234567',
          repository: 'owner/repository',
          version: 'v1.2.3',
        },
        line: 6,
      },
    ]);
  });

  it('requires consistent commits and comments across a repository release', () => {
    const commitsByRelease = new Map<string, string>();
    const versionsByCommit = new Map<string, string>();
    const first = scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: GitHub/codeql-action/init@0123456789abcdef0123456789abcdef01234567 # v3.1.0`)[0]
      ?.external;
    const conflictingCommit = scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: github/CODEQL-action/analyze@abcdef0123456789abcdef0123456789abcdef01 # v3.1.0`)[0]
      ?.external;
    const conflictingVersion = scanWorkflow(`jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: github/codeql-action/upload@0123456789abcdef0123456789abcdef01234567 # v3.1.1`)[0]
      ?.external;

    expect(first).toBeDefined();
    expect(conflictingCommit).toBeDefined();
    expect(conflictingVersion).toBeDefined();
    expect(pinConsistencyViolations(first!, commitsByRelease, versionsByCommit)).toEqual([]);
    expect(
      pinConsistencyViolations(conflictingCommit!, commitsByRelease, versionsByCommit),
    ).toEqual([
      'github/CODEQL-action/analyze uses abcdef0123456789abcdef0123456789abcdef01 # v3.1.0, but github/codeql-action@v3.1.0 also uses 0123456789abcdef0123456789abcdef01234567',
    ]);
    expect(
      pinConsistencyViolations(conflictingVersion!, commitsByRelease, versionsByCommit),
    ).toEqual([
      'github/codeql-action/upload labels 0123456789abcdef0123456789abcdef01234567 as v3.1.1, but the same commit is also labeled v3.1.0',
    ]);
  });
});
