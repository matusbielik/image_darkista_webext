// popup.ts
import { browser } from 'wxt/browser'

// Define settings type
interface Settings {
  enableInvert: boolean;
  enableHue: boolean;
  enableAuto: boolean;
  enableSimilar: boolean;
  enableReset: boolean;
  enableCompact: boolean;
}

// Add immediate console log to verify script is running
console.log('Popup script starting...')

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM Content Loaded')

  // Get DOM elements and verify they exist
  const invertSlider = document.getElementById('invert') as HTMLInputElement;
  const invertValue = document.getElementById('invert-value') as HTMLSpanElement;
  const hueSlider = document.getElementById('hue') as HTMLInputElement;
  const hueValue = document.getElementById('hue-value') as HTMLSpanElement;
  const applyAllBtn = document.getElementById('apply-all') as HTMLButtonElement;
  const resetAllBtn = document.getElementById('reset-all') as HTMLButtonElement;

  // Get settings checkboxes
  const enableInvert = document.getElementById('enable-invert') as HTMLInputElement;
  const enableHue = document.getElementById('enable-hue') as HTMLInputElement;
  const enableAuto = document.getElementById('enable-auto') as HTMLInputElement;
  const enableSimilar = document.getElementById('enable-similar') as HTMLInputElement;
  const enableReset = document.getElementById('enable-reset') as HTMLInputElement;
  const enableCompact = document.getElementById('enable-compact') as HTMLInputElement;

  // // Get containers
  // const invertContainer = document.getElementById('invert-container');
  // const hueContainer = document.getElementById('hue-container');

  console.log('Found elements:', {
    enableInvert: !!enableInvert,
    enableHue: !!enableHue,
    enableAuto: !!enableAuto,
    enableSimilar: !!enableSimilar,
    enableReset: !!enableReset,
    enableCompact: !!enableCompact
  })

  if (!enableInvert || !enableHue || !enableAuto || !enableSimilar || !enableReset || !enableCompact) {
    console.error('Some elements not found!')
    return
  }

  // Type assert after null check
  const inputs = {
    enableInvert: enableInvert as HTMLInputElement,
    enableHue: enableHue as HTMLInputElement,
    enableAuto: enableAuto as HTMLInputElement,
    enableSimilar: enableSimilar as HTMLInputElement,
    enableReset: enableReset as HTMLInputElement,
    enableCompact: enableCompact as HTMLInputElement
  }

  // Add immediate event listeners to verify they work
  Object.entries(inputs).forEach(([name, input]) => {
    input.addEventListener('click', () => {
      console.log(`${name} clicked, new value:`, input.checked)
    })
  })

  // Load saved settings
  const loadSettings = async (): Promise<Settings> => {
    const defaultSettings: Settings = {
      enableInvert: true,
      enableHue: true,
      enableAuto: true,
      enableSimilar: true,
      enableReset: true,
      enableCompact: false
    }

    try {
      const result = await browser.storage.local.get('settings')
      console.log('Loaded settings:', result)
      return result.settings as Settings || defaultSettings
    } catch (error) {
      console.error('Error loading settings:', error)
      return defaultSettings
    }
  };

  // Save settings and notify content script
  const saveSettings = async (settings: Settings) => {
    console.log('Saving settings:', settings)
    try {
      await browser.storage.local.set({ settings })

      const tabs = await browser.tabs.query({ active: true, currentWindow: true })
      const activeTab = tabs[0]

      if (activeTab?.id) {
        await browser.tabs.sendMessage(activeTab.id, {
          action: 'updateSettings',
          settings
        })
        console.log('Settings saved and sent to tab:', activeTab.id)
      } else {
        console.error('No active tab found')
      }
    } catch (error) {
      console.error('Error saving settings:', error)
    }
  };

  // Initialize settings
  const settings = await loadSettings();
  console.log('Initializing with settings:', settings)
  inputs.enableInvert.checked = settings.enableInvert
  inputs.enableHue.checked = settings.enableHue
  inputs.enableAuto.checked = settings.enableAuto
  inputs.enableSimilar.checked = settings.enableSimilar
  inputs.enableReset.checked = settings.enableReset
  enableCompact.checked = settings.enableCompact

  // Update settings when checkboxes change
  const updateSettings = async () => {
    const newSettings: Settings = {
      enableInvert: enableInvert.checked,
      enableHue: enableHue.checked,
      enableAuto: enableAuto.checked,
      enableSimilar: enableSimilar.checked,
      enableReset: enableReset.checked,
      enableCompact: enableCompact.checked
    };
    console.log('Saving new settings:', newSettings); // Debug log
    await saveSettings(newSettings);
  }

  // Add change listeners to checkboxes
  Object.values(inputs).forEach(input => {
    input.addEventListener('change', updateSettings)
    console.log('Added change listener to:', input.id)
  })

  // Update value displays
  invertSlider.addEventListener('input', () => {
    invertValue.textContent = invertSlider.value;
  });

  hueSlider.addEventListener('input', () => {
    hueValue.textContent = hueSlider.value;
  });

  // Apply to all images
  applyAllBtn.addEventListener('click', async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      browser.tabs.sendMessage(tab.id, {
        action: 'applyToAll',
        invertValue: invertSlider.value,
        hueValue: hueSlider.value
      });
    }
  });

  // Reset all images
  resetAllBtn.addEventListener('click', async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      browser.tabs.sendMessage(tab.id, { action: 'resetAll' });
    }
  });
});