// Lightworld world tools: fetch datasets, import them, validate the world, build tile sets.
import { fetchAll } from './fetch.ts';
import { importFields } from './importer.ts';

const commands: Record<string, (args: string[]) => Promise<number | void>> = {
  async fetch() {
    await fetchAll();
  },
  async import() {
    await fetchAll();
    await importFields();
  },
  async validate(args) {
    const { runValidate } = await import('./validate/index.ts');
    return runValidate(args);
  },
  async build(args) {
    const { runBuild } = await import('./build/index.ts');
    return runBuild(args);
  },
};

const [name, ...args] = process.argv.slice(2);
const command = name ? commands[name] : undefined;
if (!command) {
  console.error(`usage: world <${Object.keys(commands).join('|')}> [args]`);
  process.exit(2);
}
command(args).then(
  (code) => process.exit(typeof code === 'number' ? code : 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
