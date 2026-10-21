import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

test('Organization, Workspace and Realm identifiers remain distinct at compile time', () => {
  const fixture = fileURLToPath(new URL('./fixtures/channel-upgrade-id-types.ts', import.meta.url));
  const program = ts.createProgram([fixture], { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(item => ({ code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, '\n') })), []);
});
