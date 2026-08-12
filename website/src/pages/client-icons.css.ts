import { faClaude, faOpenai } from '@fortawesome/free-brands-svg-icons';
import {
  faClipboardCheck,
  faCode,
  faRobot,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import type { APIRoute } from 'astro';

export const prerender = true;

const CLIENT_ICONS = {
  claude: faClaude,
  evidence: faClipboardCheck,
  openai: faOpenai,
  opencode: faRobot,
  vscode: faCode,
} satisfies Record<string, IconDefinition>;

function svgDataUrl({ icon }: IconDefinition) {
  const [width, height, , , pathData] = icon;
  const paths = (Array.isArray(pathData) ? pathData : [pathData])
    .map((path) => `<path d="${path}"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const GET: APIRoute = () => {
  const properties = Object.entries(CLIENT_ICONS)
    .map(
      ([name, icon]) =>
        `  /* ${name}: ${icon.prefix} ${icon.iconName} */\n  --client-icon-${name}: url("${svgDataUrl(icon)}");`,
    )
    .join('\n');
  const body = `/*! Font Awesome Free 7.3.1 by @fontawesome — https://fontawesome.com/license/free (Icons: CC BY 4.0, Code: MIT) */\n:root {\n${properties}\n}\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
    },
  });
};
