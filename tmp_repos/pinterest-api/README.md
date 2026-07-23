# Pinterest API with Google Lens OCR and Advanced Lensing

This project provides an advanced Pinterest API integration capable of performing image-based text extraction (OCR) using Google Lens, coupled with a sophisticated "lensing" mechanism to filter and return only meaningful, complete sentences. It's designed for seamless deployment on platforms like Render and direct integration with automation tools like n8n.

## Table of Contents
- [Features](#features)
- [Getting Started](#getting-started)
  - [Local Setup](#local-setup)
  - [Deployment to Render](#deployment-to-render)
- [API Endpoints](#api-endpoints)
  - [`POST /api/pinterest/lens`](#post-apipinterestlens)
  - [`GET /api/pinterest/search-and-lens`](#get-apipinterestsearch-and-lens)
- [n8n Integration Guide](#n8n-integration-guide)
- [Lensing Logic Details](#lensing-logic-details)
- [Environment Variables](#environment-variables)

## Features

-   **Pinterest Search:** Perform searches for pins based on keywords.
-   **Google Lens OCR:** Extract text directly from Pinterest pin images using the advanced capabilities of Google Lens.
-   **Advanced Lensing Module:** A custom filtering mechanism (`lensText`) to process OCR output, ensuring only complete, meaningful, and relevant sentences are returned.
    -   Filters out short phrases (less than 4 words).
    -   Enforces minimum alphanumeric character density.
    -   Detects and filters out error messages, code snippets, and irrelevant text.
    -   Handles various sentence terminators (`.`, `!`, `?`, `\n`).
-   **Unified Endpoint for n8n (Search & Lens):** A single HTTP endpoint (`/api/pinterest/search-and-lens`) that performs a Pinterest search, then iteratively applies OCR and lensing to the results, returning only pins with high-quality extracted text. This is perfect for automation workflows.
-   **Easy Deployment:** Optimized for deployment on platforms like Render for continuous, free webhook service.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes, or deployed to a cloud service.

### Local Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Mohammedalilgrh/pinterest-api.git
    cd pinterest-api
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Environment Variables:**
    Create a `.env` file in the root directory and add the following (if you are using a custom Google Lens API URL, otherwise leave it to default):
    ```
    GOOGLE_LENS_INTERNAL_API_URL=https://lens.google.com/v3/upload # Optional, default is used if not set
    ```

4.  **Run the application:**
    ```bash
    npm start
    ```
    The server will start on `http://localhost:3000`.

### Deployment to Render

This project is designed for deployment on Render as a free webhook service.

1.  **Fork the repository:** Fork `https://github.com/Mohammedalilgrh/pinterest-api` to your own GitHub account.

2.  **Create a new Web Service on Render:**
    -   Go to [Render Dashboard](https://dashboard.render.com/).
    -   Click "New Web Service".
    -   Connect your GitHub account and select your forked `pinterest-api` repository.

3.  **Configure Build & Start Commands:**
    -   **Build Command:** `npm install`
    -   **Start Command:** `node server.js`

4.  **Environment Variables (Optional):** If you have a custom `GOOGLE_LENS_INTERNAL_API_URL`, add it under "Environment" in Render.

5.  **Deploy:** Click "Create Web Service". Render will automatically build and deploy your application. Once deployed, Render will provide you with a public URL for your service.

## API Endpoints

All endpoints return JSON responses.

### `POST /api/pinterest/lens`

Extracts and lenses text from a given image URL.

-   **Method:** `POST`
-   **URL:** `your-render-app-url/api/pinterest/lens` (or `http://localhost:3000/api/pinterest/lens` locally)
-   **Headers:** `Content-Type: application/json`
-   **Body:**
    ```json
    {
      "imageUrl": "https://example.com/your-image.jpg"
    }
    ```
-   **Responses:**
    -   **Success (200 OK):**
        ```json
        {
          "success": true,
          "text": "This is a complete and meaningful sentence extracted from the image.",
          "source": "google_lens",
          "error": null
        }
        ```
    -   **No Qualifying Text (200 OK):**
        ```json
        {
          "success": false,
          "text": null,
          "source": "google_lens",
          "error": "No qualifying sentences found after lensing."
        }
        ```
    -   **OCR Error (200 OK):**
        ```json
        {
          "success": false,
          "text": null,
          "source": "google_lens",
          "error": "Failed to perform OCR due to IP blocking.",
          "code": "IP_BLOCKED"
        }
        ```

### `GET /api/pinterest/search-and-lens`

Performs a Pinterest search, then applies OCR and lensing to pin images, returning only those with qualifying lensed text. This is the recommended endpoint for n8n integration.

-   **Method:** `GET`
-   **URL:** `your-render-app-url/api/pinterest/search-and-lens` (or `http://localhost:3000/api/pinterest/search-and-lens` locally)
-   **Query Parameters:**
    -   `query` (string, **required**): The search term for Pinterest (e.g., "healthy recipes").
    -   `count` (number, optional): The desired number of qualifying pins to return. Defaults to 5.

-   **Example Request:**
    `your-render-app-url/api/pinterest/search-and-lens?query=inspirational%20quotes&count=3`

-   **Responses:**
    -   **Success (200 OK):**
        ```json
        {
          "success": true,
          "query": "inspirational quotes",
          "count": 2,
          "data": [
            {
              "id": "12345",
              "imageUrl": "https://i.pinimg.com/some-image-1.jpg",
              "description": "A beautiful quote about life.",
              "lensedText": "Life is an echo. What you send out comes back."
            },
            {
              "id": "67890",
              "imageUrl": "https://i.pinimg.com/some-image-2.jpg",
              "description": "Daily motivation.",
              "lensedText": "Believe you can and you're halfway there."
            }
          ]
        }
        ```
    -   **Error (500 Internal Server Error):**
        ```json
        {
          "success": false,
          "error": "An unexpected error occurred."
        }
        ```

## n8n Integration Guide

Use the `GET /api/pinterest/search-and-lens` endpoint directly in an n8n HTTP Request node.

1.  **Add an HTTP Request Node:** In your n8n workflow, add an "HTTP Request" node.

2.  **Configure the HTTP Request Node:**
    -   **Method:** `GET`
    -   **URL:** Enter the deployed URL of your Render service, followed by `/api/pinterest/search-and-lens`.
        *Example:* `https://your-render-app.onrender.com/api/pinterest/search-and-lens`
    -   **Query Parameters:** Add `query` and `count` as needed.
        -   **Name:** `query`
        -   **Value:** Your desired search term (e.g., `{{$node["Start"].data["search_term"]}}` if dynamic from a previous node).
        -   **Name:** `count`
        -   **Value:** Desired number of results (e.g., `5`).

3.  **Process the Response:** The output of the HTTP Request node will be JSON containing `data` (an array of lensed pins). You can then use subsequent n8n nodes (e.g., "Item Lists" or "Function" nodes) to process this data.

## Lensing Logic Details

The `lensText` function applies several filters to the raw OCR output to ensure high-quality, meaningful sentences:

1.  **Alphanumeric Content Check:** Filters out sentences that do not contain any letters or numbers.
2.  **Minimum Word Count:** Sentences with fewer than 4 words are discarded.
3.  **Alphanumeric Ratio:**
    -   For longer sentences (over 10 characters), at least 70% of characters must be alphanumeric.
    -   For shorter sentences (1-10 characters), at least 85% of characters must be alphanumeric.
    This helps filter out sentences dominated by special characters or punctuation.
4.  **Error Keyword Detection:** Filters out sentences containing common error keywords or code snippets (e.g., `Error:`, `Traceback`, `def `, `import `, `SyntaxError`, `HTTP ERROR`).
5.  **Punctuation Handling:** Sentences are primarily segmented by standard terminators (`.`, `!`, `?`, `\n`). Trailing sentences without punctuation are included if they are sufficiently long (>= 6 words).

## Environment Variables

-   `GOOGLE_LENS_INTERNAL_API_URL` (Optional): Specifies the Google Lens internal API endpoint. Defaults to `https://lens.google.com/v3/upload`. You generally do not need to set this unless you are using a proxy or a different endpoint.