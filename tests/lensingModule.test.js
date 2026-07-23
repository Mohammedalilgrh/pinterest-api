// tmp_repos/pinterest-api/tests/lensingModule.test.js
const { lensText } = require('../server');
const assert = require('assert');

function runTest(name, func) {
    try {
        func();
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(error);
    }
}

// Ensure the tests directory exists first (handled in Step 3)

runTest('Lensing Module - Basic Test Structure Check', () => {
    assert.strictEqual(typeof lensText, 'function', 'lensText should be a function');
});

runTest('Lensing Module - Should return null for empty or invalid input', () => {
    assert.strictEqual(lensText(null), null, 'null input should return null');
    assert.strictEqual(lensText(''), null, 'empty string should return null');
    assert.strictEqual(lensText('   '), null, 'whitespace string should return null');
});

runTest('Lensing Module - Should return meaningful sentences', () => {
    const input = "Hello, world! This is a complete sentence. Another one here?";
    const expected = "This is a complete sentence.";
    assert.strictEqual(lensText(input), expected, 'should extract multiple complete sentences');
});

runTest('Lensing Module - Should filter out short phrases', () => {
    const input = "Too short. This is a complete sentence.";
    const expected = "This is a complete sentence.";
    assert.strictEqual(lensText(input), expected, 'should filter out short sentences');
});

runTest('Lensing Module - Should filter out sentences with excessive special characters', () => {
    const input = "This is good text. ###@!$ This is bad. Another good one.";
    const expected = "This is good text.";
    assert.strictEqual(lensText(input), expected, 'should filter out sentences with too many special chars');
});

runTest('Lensing Module - Should filter out error messages/code', () => {
    const input = "Error: Something went wrong. This is a normal sentence. Traceback (most recent call last).";
    const expected = "This is a normal sentence.";
    assert.strictEqual(lensText(input), expected, 'should filter out error messages');
});

runTest('Lensing Module - Should handle mixed content', () => {
    const input = "This is a great day! #HashTag. Enjoy it. def my_func(): print('hello'). Final good sentence.";
    const expected = "This is a great day!";
    assert.strictEqual(lensText(input), expected, 'should handle mixed content correctly');
});

runTest('Lensing Module - Should return null if no qualifying sentences', () => {
    const input = "Short. ##@!$. Error: failed. Def func.";
    assert.strictEqual(lensText(input), null, 'should return null if no qualifying sentences are found');
});

runTest('Lensing Module - Should handle sentences without ending punctuation but appear complete', () => {
    const input = "This sentence seems complete without an ending mark. Another good sentence!";
    const expected = "This sentence seems complete without an ending mark.";
    assert.strictEqual(lensText(input), expected, 'should retain seemingly complete sentences without end punctuation');
});