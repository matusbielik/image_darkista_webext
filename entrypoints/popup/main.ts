import { browser } from '#imports';
import type { ContentCommand } from '../../shared/messages';
import { loadSettings, saveSettings, type Settings } from '../../shared/settings';

document.addEventListener('DOMContentLoaded', async () => {
  const invert = document.getElementById('invert') as HTMLInputElement;
  const invertValue = document.getElementById('invert-value') as HTMLSpanElement;
  const hue = document.getElementById('hue') as HTMLInputElement;
  const hueValue = document.getElementById('hue-value') as HTMLSpanElement;
  const apply = document.getElementById('apply-all') as HTMLButtonElement;
  const reset = document.getElementById('reset-all') as HTMLButtonElement;
  const inputs: Record<keyof Settings, HTMLInputElement> = {
    enableInvert: document.getElementById('enable-invert') as HTMLInputElement,
    enableHue: document.getElementById('enable-hue') as HTMLInputElement,
    enableAuto: document.getElementById('enable-auto') as HTMLInputElement,
    enableSimilar: document.getElementById('enable-similar') as HTMLInputElement,
    enableReset: document.getElementById('enable-reset') as HTMLInputElement,
    enableCompact: document.getElementById('enable-compact') as HTMLInputElement,
  };

  try {
    const settings = await loadSettings();
    for (const key of Object.keys(inputs) as (keyof Settings)[]) {
      inputs[key].checked = settings[key];
    }
  } catch (error) { console.error('Failed to load settings:', error); }

  const persist = async (): Promise<void> => {
    try {
      await saveSettings({
        enableInvert: inputs.enableInvert.checked,
        enableHue: inputs.enableHue.checked,
        enableAuto: inputs.enableAuto.checked,
        enableSimilar: inputs.enableSimilar.checked,
        enableReset: inputs.enableReset.checked,
        enableCompact: inputs.enableCompact.checked,
      });
    } catch (error) { console.error('Failed to save settings:', error); }
  };
  Object.values(inputs).forEach(input => input.addEventListener('change', persist));
  invert.addEventListener('input', () => { invertValue.textContent = invert.value; });
  hue.addEventListener('input', () => { hueValue.textContent = hue.value; });

  const send = async (command: ContentCommand): Promise<void> => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined) throw new Error('No active tab');
    await browser.tabs.sendMessage(tab.id, command);
  };
  apply.addEventListener('click', async () => {
    try {
      await send({ action: 'applyToAll', invertValue: invert.value, hueValue: hue.value });
    } catch (error) { console.error('Failed to apply filters to all images:', error); }
  });
  reset.addEventListener('click', async () => {
    try { await send({ action: 'resetAll' }); }
    catch (error) { console.error('Failed to reset all images:', error); }
  });
});
