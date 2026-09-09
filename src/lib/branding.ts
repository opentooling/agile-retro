/**
 * Deployment branding.
 *
 * The product name, tagline and page description are read from the environment
 * so one image can be deployed under whatever name an organisation uses,
 * without a rebuild. Set them in the Helm chart under `app.branding`.
 *
 * These are read on the server. Client components receive them as props from
 * the root layout rather than through NEXT_PUBLIC_* vars, because those are
 * inlined at build time and would defeat the point of configuring them per
 * deployment.
 */

export type Branding = {
  /** Product name, e.g. in the sidebar and the browser tab. */
  name: string;
  /** One-line tagline shown under the name on the login screen. */
  tagline: string;
  /** Meta description for the page head. */
  description: string;
};

export const DEFAULT_BRANDING: Branding = {
  name: "Agile Retro",
  tagline: "Sign in to create or join retrospectives",
  description: "Run and track team retrospectives.",
};

/** Branding for this deployment, falling back to the neutral defaults. */
export function branding(): Branding {
  const name = process.env.APP_NAME?.trim();
  const tagline = process.env.APP_TAGLINE?.trim();
  const description = process.env.APP_DESCRIPTION?.trim();
  return {
    name: name || DEFAULT_BRANDING.name,
    tagline: tagline || DEFAULT_BRANDING.tagline,
    // A deployment that sets a name but no description gets a sensible one
    // rather than a description naming a different product.
    description: description || (name ? `Run and track team retrospectives for ${name}.` : DEFAULT_BRANDING.description),
  };
}
