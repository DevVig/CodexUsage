export function getTheme(name = process.env.CODEX_THEME || 'default') {
  switch (name) {
    case 'mono':
      return {
        lineColor: 'white',
        textColor: 'white',
        gauge: { stroke: 'white', fill: 'white' },
        accent: 'white',
      };
    case 'solarized':
      return {
        lineColor: 'yellow',
        textColor: 'white',
        gauge: { stroke: 'yellow', fill: 'white' },
        accent: 'cyan',
      };
    default:
      return {
        lineColor: 'cyan',
        textColor: 'white',
        gauge: { stroke: 'green', fill: 'white' },
        accent: 'magenta',
      };
  }
}

