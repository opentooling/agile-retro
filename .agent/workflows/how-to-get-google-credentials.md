---
description: How to get Google Client ID and Secret for OIDC Authentication
---

# How to get Google Client ID and Secret

To enable "Sign in with Google", you need to create credentials in the Google Cloud Console.

1.  **Go to Google Cloud Console**
    *   Visit [https://console.cloud.google.com/](https://console.cloud.google.com/)

2.  **Create a Project**
    *   Click the project dropdown in the top bar.
    *   Click **New Project**.
    *   Name it "Agile Retro" (or anything you like) and click **Create**.

3.  **Configure OAuth Consent Screen**
    *   In the search bar, type "OAuth consent screen" and select it.
    *   Select **External** (unless you have a Google Workspace organization) and click **Create**.
    *   **App Information**:
        *   App name: Agile Retro
        *   User support email: Select your email
    *   **Developer Contact Information**:
        *   Email addresses: Enter your email
    *   Click **Save and Continue** through the other steps (Scopes, Test Users).
    *   *Note*: For testing, add your own email as a "Test User" if you selected External.

4.  **Create Credentials**
    *   Go to **Credentials** in the left menu.
    *   Click **+ Create Credentials** > **OAuth client ID**.
    *   **Application type**: Web application.
    *   **Name**: Agile Retro Web Client.
    *   **Authorized JavaScript origins**:
        *   `http://localhost:3000`
    *   **Authorized redirect URIs**:
        *   `http://localhost:3000/api/auth/callback/google`
    *   Click **Create**.

5.  **Copy Credentials**
    *   You will see a dialog with your **Client ID** and **Client Secret**.
    *   Copy these values.

6.  **Update Environment Variables**
    *   Create or update your `.env` file in the project root:
    ```env
    AUTH_GOOGLE_ID=your_client_id_here
    AUTH_GOOGLE_SECRET=your_client_secret_here
    AUTH_SECRET=generate_a_random_string_here
    ```
    *   *Tip*: You can generate a random secret by running `openssl rand -base64 32` in your terminal.
