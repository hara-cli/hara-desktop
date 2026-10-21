import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('public workspace documentation and release copy exclude private handoffs and acceptance receipts', () => {
  for (const file of ['docs/DESKTOP_104_FORWARDPORT_110.md','docs/LOCAL_CHANNELS.md','docs/workspace-shell-redesign-1.1.0.md','docs/RELEASE_NOTES_1.1.0_DRAFT.md','docs/RELEASE_NOTES_1.1.0.en.md','docs/RELEASE_NOTES_1.1.0.zh-Hans.md','docs/PUBLIC_ANNOUNCEMENT_1.1.0_DRAFT.md']) {
    assert.doesNotMatch(read(file), /\binbox\b|\/Users\/|\.worktrees\/|\b(?:main|highlight)-\d{4}\b|\b[A-Z][a-z]+ (?:approved|cancelled|stopped)\b|candidate (?:provenance|status)|\bhara:\d/i, file);
  }
});

test('theme and translation comments describe implementation without private design provenance', () => {
  for (const file of ['src/workspace-theme.css','src/workspace-shell-layout.css','src/workspace-local-dev.css','src/workspace-settings.css','src/workspace-i18n.ts','src/workspace-settings-i18n.ts']) {
    const comments = read(file).match(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm) ?? [];
    for (const comment of comments) assert.doesNotMatch(comment, /\b(?:main|highlight)-\d{4}\b|\b[A-Z][a-z]+ (?:approved|cancelled)\b|\b20\d\d-\d\d-\d\d\b|v\d\.\d-r overlay|\/Users\/|\.\.\/inbox/, file);
  }
});

test('workflow guide keeps machine-specific signing locations in private operator configuration', () => {
  const guide = read('WORKFLOW.md');
  assert.doesNotMatch(guide, /~\/Library\/Keychains\/|~\/\.tauri\//);
  assert.match(guide, /HARA_CODESIGN_KEYCHAIN_PASSWORD_FILE/);
  assert.match(guide, /must not write, repair or restore the user's global search list/);
});
