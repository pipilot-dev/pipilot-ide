// Smoke test: run_code MCP tool — end-to-end via OneCompiler API
// Tests multiple languages, stdin, error handling, and key fallback

require('dotenv').config();

const { runCode } = require('../main/mcp-ide-tools');

var passed = 0;
var failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    console.log('  PASS:', name);
    passed++;
  } else {
    console.log('  FAIL:', name, detail || '');
    failed++;
  }
}

async function run() {
  console.log('=== run_code MCP Tool Smoke Test ===\n');

  // 1. JavaScript
  console.log('--- JavaScript ---');
  var js = await runCode({ language: 'javascript', code: 'console.log(2 + 2)' });
  assert('JS runs', js.status === 'success');
  assert('JS output', js.output && js.output.trim() === '4', 'got: ' + (js.output || '').trim());
  assert('JS has exec time', !!js.executionTime);

  // 2. Python
  console.log('\n--- Python ---');
  var py = await runCode({ language: 'python', code: 'print("hello from python")' });
  assert('Python runs', py.status === 'success');
  assert('Python output', py.output && py.output.trim() === 'hello from python', 'got: ' + (py.output || '').trim());

  // 3. C++
  console.log('\n--- C++ ---');
  var cpp = await runCode({
    language: 'cpp',
    code: '#include <iostream>\nint main() { std::cout << "C++ works" << std::endl; return 0; }'
  });
  assert('C++ runs', cpp.status === 'success');
  assert('C++ output', cpp.output && cpp.output.trim() === 'C++ works', 'got: ' + (cpp.output || '').trim());
  assert('C++ has compile time', !!cpp.compilationTime);

  // 4. Java
  console.log('\n--- Java ---');
  var java = await runCode({
    language: 'java',
    code: 'public class Main { public static void main(String[] args) { System.out.println("Java " + (10 * 5)); } }'
  });
  assert('Java runs', java.status === 'success');
  assert('Java output', java.output && java.output.trim() === 'Java 50', 'got: ' + (java.output || '').trim());

  // 5. Go
  console.log('\n--- Go ---');
  var go = await runCode({
    language: 'go',
    code: 'package main\nimport "fmt"\nfunc main() { fmt.Println("Go", 1+2) }'
  });
  assert('Go runs', go.status === 'success');
  assert('Go output', go.output && go.output.trim() === 'Go 3', 'got: ' + (go.output || '').trim());

  // 6. Rust
  console.log('\n--- Rust ---');
  var rs = await runCode({
    language: 'rust',
    code: 'fn main() { println!("Rust {}", 42); }'
  });
  assert('Rust runs', rs.status === 'success');
  assert('Rust output', rs.output && rs.output.trim() === 'Rust 42', 'got: ' + (rs.output || '').trim());

  // 7. TypeScript
  console.log('\n--- TypeScript ---');
  var ts = await runCode({
    language: 'typescript',
    code: 'const greet = (name: string): string => `Hello ${name}`;\nconsole.log(greet("TypeScript"));'
  });
  assert('TS runs', ts.status === 'success');
  assert('TS output', ts.output && ts.output.trim() === 'Hello TypeScript', 'got: ' + (ts.output || '').trim());

  // 8. Python with stdin
  console.log('\n--- Python + stdin ---');
  var pyin = await runCode({
    language: 'python',
    code: 'name = input()\nprint(f"Hi {name}!")',
    stdin: 'World'
  });
  assert('stdin works', pyin.status === 'success');
  assert('stdin output', pyin.output && pyin.output.trim() === 'Hi World!', 'got: ' + (pyin.output || '').trim());

  // 9. Compile error (C with syntax error)
  console.log('\n--- Compile error ---');
  var err = await runCode({
    language: 'c',
    code: 'int main() { printf("missing include") }'
  });
  assert('Error detected', err.output && (err.output.includes('error') || err.output.includes('warning')));

  // 10. Ruby
  console.log('\n--- Ruby ---');
  var rb = await runCode({ language: 'ruby', code: 'puts "Ruby #{3 * 7}"' });
  assert('Ruby runs', rb.status === 'success');
  assert('Ruby output', rb.output && rb.output.trim() === 'Ruby 21', 'got: ' + (rb.output || '').trim());

  // Summary
  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  if (failed > 0) process.exit(1);
}

run().catch(function (e) { console.error('ERROR:', e); process.exit(1); });
