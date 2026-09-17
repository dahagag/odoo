/** The one navigation `VerifyPage` performs on a successful sign-in - extracted into its own
 * seam so a test can mock this call directly instead of replacing jsdom's own `window.location`
 * (CodeRabbit, PR #318: jsdom 25+ makes `window.location` non-configurable; the correct
 * workaround for that still leaves a partial stub object other code could silently read
 * `undefined` off of, which this seam avoids entirely). */
export function redirectToDashboard(): void {
  window.location.replace('/dashboard');
}
