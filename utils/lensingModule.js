// tmp_repos/pinterest-api/utils/lensingModule.js

function lensText(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
        return null;
    }

    const qualifyingSentences = [];
    let currentSentence = [];
    const terminators = ['.', '!', '?', '\n']; // Explicit sentence terminators

    for (let i = 0; i < rawText.length; i++) {
        const char = rawText[i];
        currentSentence.push(char);

        // Check if the current character is a terminator
        if (terminators.includes(char)) {
            let sentence = currentSentence.join('').trim();
            if (sentence.length > 0) {

                // Apply filtering logic to 'sentence'
                if (!/[a-zA-Z0-9]/.test(sentence)) { // Ensure it has actual words/numbers
                    currentSentence = []; // Discard and reset
                    continue;
                }

                const words = sentence.split(/\s+/).filter(word => word.length > 0);
                if (words.length < 4) { // Minimum Length Check (e.g., 4 words)
                    currentSentence = [];
                    continue;
                }

                const alphanumericCount = (sentence.match(/[a-zA-Z0-9]/g) || []).length;
                const totalCount = sentence.length;

                if (totalCount > 10 && (alphanumericCount / totalCount < 0.5)) { // Less than 50% alphanumeric for longer sentences
                    currentSentence = [];
                    continue;
                }
                if (totalCount <= 10 && totalCount > 0 && (alphanumericCount / totalCount < 0.7)) { // Less than 70% alphanumeric for shorter sentences
                    currentSentence = [];
                    continue;
                }

                const errorKeywords = ['Error:', 'Traceback', 'def ', 'import ', 'function ', 'class ', 'SyntaxError', 'TypeError', 'HTTP ERROR', 'Failed'];
                if (errorKeywords.some(keyword => sentence.includes(keyword))) { // Error Keyword Detection
                    currentSentence = [];
                    continue;
                }

                // Punctuation Check - If it doesn't end with strong punctuation, it might be a fragment.
                if (!/[.!?]$/.test(sentence)) {
                    if (words.length < 6 && totalCount < 30) { // If short/medium and no end punctuation, filter out more strictly
                        currentSentence = [];
                        continue;
                    }
                }

                qualifyingSentences.push(sentence);
            }
            currentSentence = []; // Reset buffer after a terminator
        }
    }

    // Process any remaining text in currentSentence buffer if no terminator at end of string
    if (currentSentence.length > 0) {
        let sentence = currentSentence.join('').trim();
        if (sentence.length > 0) {
            // Apply filtering logic
            if (!/[a-zA-Z0-9]/.test(sentence)) {
                // do nothing
            } else {
                const words = sentence.split(/\s+/).filter(word => word.length > 0);
                if (words.length >= 4) { // Minimum Length Check
                    const alphanumericCount = (sentence.match(/[a-zA-Z0-9]/g) || []).length;
                    const totalCount = sentence.length;

                    if (totalCount > 10 && (alphanumericCount / totalCount < 0.5)) {
                        // do nothing
                    } else if (totalCount <= 10 && totalCount > 0 && (alphanumericCount / totalCount < 0.7)) {
                        // do nothing
                    } else {
                        const errorKeywords = ['Error:', 'Traceback', 'def ', 'import ', 'function ', 'class ', 'SyntaxError', 'TypeError', 'HTTP ERROR', 'Failed'];
                        if (!errorKeywords.some(keyword => sentence.includes(keyword))) {
                            // Punctuation Check - more lenient for trailing sentence
                            if (!/[.!?]$/.test(sentence)) {
                                if (words.length >= 6) { // If long enough and meaningful without end punctuation
                                     qualifyingSentences.push(sentence);
                                }
                            } else {
                                qualifyingSentences.push(sentence); // Has punctuation, so it's good
                            }
                        }
                    }
                }
            }
        }
    }

    return qualifyingSentences.length > 0 ? qualifyingSentences.join('\n') : null;
}