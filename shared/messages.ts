export type ContentCommand =
  | { action: 'applyToAll'; invertValue: string; hueValue: string }
  | { action: 'resetAll' };
