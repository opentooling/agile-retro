# Authentication Configuration

The Agile Retro application supports multiple authentication providers simultaneously. Currently, **Google** and **Keycloak** are supported.

You can enable one or both by setting the corresponding environment variables.

## Environment Variables

Add the following variables to your `.env` file (locally) or your deployment configuration (Helm values).

### Common
```bash
AUTH_SECRET="your-random-secret-string" # Required for NextAuth
```

### Google Provider
To enable Google authentication:
```bash
AUTH_GOOGLE_ID="your-google-client-id"
AUTH_GOOGLE_SECRET="your-google-client-secret"
```

### Keycloak Provider
To enable Keycloak authentication:
```bash
AUTH_KEYCLOAK_ID="your-keycloak-client-id"
AUTH_KEYCLOAK_SECRET="your-keycloak-client-secret"
AUTH_KEYCLOAK_ISSUER="http://your-keycloak-domain/realms/your-realm"
```

## How it works

- The application checks for the presence of these variables at startup.
- If `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are present, the Google login option will appear.
- If `AUTH_KEYCLOAK_ID`, `AUTH_KEYCLOAK_SECRET`, and `AUTH_KEYCLOAK_ISSUER` are present, the Keycloak login option will appear.
- If both sets are present, **both** options will be displayed on the login page.

## Helm Chart Configuration

You can configure these in your `values.yaml` file under the `auth` section:

```yaml
auth:
  secret: "change-me-in-production"
  # OR use an existing secret
  # existingSecret: "my-auth-secret"
  # existingSecretKey: "auth-secret"

  google:
    enabled: true
    clientId: "your-google-client-id"
    # clientSecret: "your-google-client-secret"
    # OR use an existing secret
    existingSecret: "google-creds"
    existingSecretKey: "client-secret"

  keycloak:
    enabled: true
    clientId: "your-keycloak-client-id"
    # clientSecret: "your-keycloak-client-secret"
    # OR use an existing secret
    existingSecret: "keycloak-creds"
    existingSecretKey: "client-secret"
    issuer: "http://keycloak.example.com/realms/myrealm"
```

### Creating Kubernetes Secrets

If you choose to use existing secrets, here is how you can create them:

**For Google:**
```bash
kubectl create secret generic google-creds \
  --from-literal=client-secret='your-google-client-secret'
```

**For Keycloak:**
```bash
kubectl create secret generic keycloak-creds \
  --from-literal=client-secret='your-keycloak-client-secret'
```

**For NextAuth Secret:**
```bash
kubectl create secret generic auth-secret \
  --from-literal=auth-secret='your-random-secret-string'
```

### Keycloak Configuration

To ensure **Federated Logout** works correctly (i.e., signing out of the app also signs you out of Keycloak):

1.  In your Keycloak Client settings, find **Valid Post Logout Redirect URIs**.
2.  Add your application's URL (e.g., `http://localhost:3000` or `https://your-app.com`) or simply `+`.
3.  Ensure **Front-Channel Logout** is enabled if applicable, though the app uses the OIDC logout endpoint directly.

## Authorization & Roles

The application implements a role-based authorization system:

1.  **Default Role**: Every authenticated user is automatically assigned the `user` role.
2.  **Admin Role**: Users authenticated via Keycloak who have the `admin` role assigned in Keycloak (specifically in `realm_access.roles`) will automatically receive the `admin` role in the application.

These roles are available in the user session (`session.roles`) and can be used to control access to specific features or pages.
