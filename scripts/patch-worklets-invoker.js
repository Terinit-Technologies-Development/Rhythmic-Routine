const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-modules-core',
  'android',
  'src',
  'main',
  'cpp',
  'worklets',
  'WorkletJSCallInvoker.cpp'
);

if (fs.existsSync(target)) {
  let content = fs.readFileSync(target, 'utf8');
  if (content.includes('executeSync')) {
    content = content.replace(
      /workletRuntime->executeSync\(\[func = std::move\(func\)\]\(jsi::Runtime &rt\) -> jsi::Value \{\s+func\(rt\);\s+return jsi::Value::undefined\(\);\s+\}\);/,
      'workletRuntime->runSync(func);'
    );
    fs.writeFileSync(target, content, 'utf8');
    console.log('[patch] Patched WorkletJSCallInvoker.cpp with upstream runSync()');
  }
}
