// File-name placeholders in an adapter's conventions: {name} is the component name as
// given (PascalCase, e.g. ModalActions); {kebab} is its kebab-case form (modal-actions),
// which frameworks such as Angular use for file names and selectors.

export const NAME_PLACEHOLDERS = /{(name|kebab)}/g;

export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2").toLowerCase();
}

export function fillName(placeholder: string, name: string): string {
  return placeholder === "{kebab}" ? kebab(name) : name;
}
