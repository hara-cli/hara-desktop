export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the bounded, temporary selection path for older WebViews.
  }

  let input: HTMLTextAreaElement | undefined;
  try {
    input = document.createElement("textarea");
    input.value = text;
    input.readOnly = true;
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    input.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input?.remove();
  }
}
