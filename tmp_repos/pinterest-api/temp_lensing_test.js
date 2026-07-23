function lensText(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
        return null;
    }

    const qualifyingSentences = [];
    let currentSentence = [];
    const terminators = ['.', '!', '?', '\n'];

    for (let i = 0; i < rawText.length; i++) {
        const char = rawText[i];
        currentSentence.push(char);

        if (terminators.includes(char)) {
            let sentence = currentSentence.join('').trim();
            if (sentence.length > 0) {
                if (!/[a-zA-Z0-9]/.test(sentence)) {
                    currentSentence = [];
                    continue;
                }

                const words = sentence.split(/\s+/).filter(word => word.length > 0);
                if (words.length < 4) {
                    currentSentence = [];
                    continue;
                }

                const alphanumericCount = (sentence.match(/[a-zA-Z0-9]/g) || []).length;
                const totalCount = sentence.length;

                if (totalCount > 10 && (alphanumericCount / totalCount < 0.5)) {
                    currentSentence = [];
                    continue;
                }
                if (totalCount <= 10 && totalCount > 0 && (alphanumericCount / totalCount < 0.7)) {
                    currentSentence = [];
                    continue;
                }

                const errorKeywords = ['Error:', 'Traceback', 'def ', 'import ', 'function ', 'class ', 'SyntaxError', 'TypeError', 'HTTP ERROR', 'Failed'];
                if (errorKeywords.some(keyword => sentence.includes(keyword))) {
                    currentSentence = [];
                    continue;
                }

                if (!/[.!?]$/.test(sentence)) {
                    if (words.length < 6 && totalCount < 30) {
                        currentSentence = [];
                        continue;
                    }
                }

                qualifyingSentences.push(sentence);
            }
            currentSentence = [];
        }
    }

    if (currentSentence.length > 0) {
        let sentence = currentSentence.join('').trim();
        if (sentence.length > 0) {
            if (!/[a-zA-Z0-9]/.test(sentence)) {
            } else {
                const words = sentence.split(/\s+/).filter(word => word.length > 0);
                if (words.length >= 4) {
                    const alphanumericCount = (sentence.match(/[a-zA-Z0-9]/g) || []).length;
                    const totalCount = sentence.length;

                    if (totalCount > 10 && (alphanumericCount / totalCount < 0.5)) {
                    }
                    else if (totalCount <= 10 && totalCount > 0 && (alphanumericCount / totalCount < 0.7)) {
                    }
                    else {
                        const errorKeywords = ['Error:', 'Traceback', 'def ', 'import ', 'function ', 'class ', 'SyntaxError', 'TypeError', 'HTTP ERROR', 'Failed'];
                        if (!errorKeywords.some(keyword => sentence.includes(keyword))) {
                            if (!/[.!?]$/.test(sentence)) {
                                if (words.length >= 6) {
                                     qualifyingSentences.push(sentence);
                                }
                            } else {
                                qualifyingSentences.push(sentence);
                            }
                        }
                    }
                }
            }
        }
    }

    return qualifyingSentences.length > 0 ? qualifyingSentences.join('\n') : null;
}

const input1 = "Hello, world! This is a complete sentence.";
const expected1 = "Hello, world!\nThis is a complete sentence.";
const result1 = lensText(input1);
console.log('Test 1 - Basic sentences:');
console.log('Expected:', expected1);
console.log('Actual:', result1);
console.log('Match:', result1 === expected1);

const input2 = "Too short. This is a complete sentence.";
const expected2 = "This is a complete sentence.";
const result2 = lensText(input2);
console.log('Test 2 - Short sentence filtered:');
console.log('Expected:', expected2);
console.log('Actual:', result2);
console.log('Match:', result2 === expected2);

const input3 = "Error: Something went wrong. This is a normal sentence.";
const expected3 = "This is a normal sentence.";
const result3 = lensText(input3);
console.log('Test 3 - Error sentence filtered:');
console.log('Expected:', expected3);
console.log('Actual:', result3);
console.log('Match:', result3 === expected3);

const input4 = "Short. ##@!$. Error: failed.";
const expected4 = null;
const result4 = lensText(input4);
console.log('Test 4 - All filtered:');
console.log('Expected:', expected4);
console.log('Actual:', result4);
console.log('Match:', result4 === expected4);