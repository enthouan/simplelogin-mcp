export const REPOSITORY_URL = 'https://github.com/enthouan/simplelogin-mcp';
export const REPOSITORY_VISIBILITY_ENV = 'WEBSITE_REPOSITORY_PUBLIC';

export function resolveRepositoryUrl(
  publicationUrl: URL | undefined,
  repositoryPublic: string | undefined,
): string | undefined {
  return publicationUrl && repositoryPublic !== 'true' ? undefined : REPOSITORY_URL;
}
