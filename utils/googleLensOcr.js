// tmp_repos/pinterest-api/utils/googleLensOcr.js
const axios = require('axios');

async function ocrImage(imageUrl) {
    const GOOGLE_LENS_API_ENDPOINT = process.env.GOOGLE_LENS_INTERNAL_API_URL || 'https://lens.google.com/v3/upload'; // Placeholder - actual URL may vary

    try {
        const response = await axios.post(GOOGLE_LENS_API_ENDPOINT, {
            imageUrl: imageUrl,
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000 // 30 seconds timeout for OCR
        });

        if (response.data && response.data.text) {
            return {
                success: true,
                text: response.data.text,
                language: response.data.language || 'en',
                segments: response.data.segments || []
            };
        } else if (response.data && response.data.responses && response.data.responses.length > 0) {
             const firstResponse = response.data.responses[0];
             if (firstResponse.fullTextAnnotation && firstResponse.fullTextAnnotation.text) {
                 return {
                    success: true,
                    text: firstResponse.fullTextAnnotation.text,
                    language: firstResponse.fullTextAnnotation.text.match(/[^\x00-\x7F]/) ? 'multilingual' : 'en',
                    segments: []
                 };
             }
        }

        return { success: false, error: 'No text extracted', code: 'NO_TEXT_FOUND' };

    } catch (error) {
        console.error(`Google Lens OCR Error for ${imageUrl}:`, error.message);
        let errorMessage = 'OCR request failed';
        let errorCode = 'OCR_FAILED';

        if (error.response) {
            errorMessage = error.response.data.error || errorMessage;
            errorCode = error.response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
            if (error.response.status === 403) {
                errorMessage = 'Google Lens IP blocking detected or access denied.';
                errorCode = 'IP_BLOCKED';
            }
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            errorMessage = 'OCR request timed out.';
            errorCode = 'TIMEOUT';
        }

        return { success: false, error: errorMessage, code: errorCode };
    }
}

module.exports = { ocrImage };