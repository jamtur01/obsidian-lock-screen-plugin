const MASK_CLASS = "edb-masked-input";

/**
 * Masks a password field without `type="password"`, which triggers macOS Secure Input and
 * blocks text-expansion utilities.
 *
 * The stylesheet class is the primary mechanism. The inline declaration duplicates it so the
 * field stays masked if `styles.css` fails to load or a CSS snippet overrides the rule —
 * losing the stylesheet would otherwise render the password in cleartext at full size.
 */
export const maskPasswordInput = (input: HTMLInputElement): void => {
	input.type = "text";
	input.spellcheck = false;
	input.setAttribute("autocapitalize", "none");
	input.classList.add(MASK_CLASS);
	input.style.setProperty("-webkit-text-security", "disc", "important");
};
