/*      Blackmagic Camera Control WebUI
        WebUI Script functions
        (c) Dylan Speiser 2024              
        github.com/DylanSpeiser
*/

/* Preset Configuration - Defines which settings should be included in presets */
const PRESET_CONFIG = {
    focus: true,          // Focus settings
    autoFocus: true,      // Auto focus settings
    iris: true,           // Iris/aperture settings
    gain: true,           // Gain/ISO settings
    shutter: true,        // Shutter speed/angle
    whiteBalance: true,   // White balance and tint
    ndFilter: true,       // ND filter settings
    colorCorrection: {    // Color correction settings
        enabled: true,    // Master switch for all color correction
        lift: true,       // Lift (shadows)
        gamma: true,      // Gamma (midtones)
        gain: true,       // Gain (highlights)
        offset: true      // Offset
    },
    contrast: true,       // Contrast settings
    color: true,          // Color (hue, saturation, luma contribution)
    autoExposure: true    // Auto exposure mode and settings
};

// Helper function to check if a property is available on the current camera
function isPropertyAvailable(path) {
    if (!cameras[ci] || !cameras[ci].propertyData) return false;
    return cameras[ci].propertyData[path] !== undefined && 
           cameras[ci].propertyData[path] !== null;
}

// Helper function to safely get a property value
function getSafeProperty(path) {
    if (isPropertyAvailable(path)) {
        return cameras[ci].propertyData[path];
    }
    return null;  // Return null for unavailable properties
}

/* Global variables */
var cameras = [];       // Array to store all of the camera objects
var ci = 0;             // Index into this array for the currently selected camera.
// cameras[ci] is used to reference the currently selected camera object

var WBMode = 0;         // 0: balance, 1: tint

var defaultControlsHTML;

var unsavedChanges = [];

// Variable to store copied preset
var copiedPreset = null;

// Helper function to safely update element
function safeUpdateElement(id, updateFn) {
    const element = document.getElementById(id);
    if (element) {
        try {
            updateFn(element);
        } catch (error) {
            console.error(`Error updating element ${id}:`, error);
        }
    } else {
        console.warn(`Element ${id} not found`);
    }
}

// Set everything up
function bodyOnLoad() {
    safeUpdateElement("allCamerasContainer", (element) => {
        defaultControlsHTML = element.innerHTML;
    });
    
    safeUpdateElement("hostnameInput", (element) => {
        element.value = localStorage.getItem("camerahostname_"+ci.toString()) || "";
    });
    
    safeUpdateElement("secureCheckbox", (element) => {
        element.checked = localStorage.getItem("camerasecurity_"+ci.toString()) === 'true';
    });
}

// Checks the hostname, if it replies successfully then a new BMCamera object
//  is made and gets put in the array at ind
function initCamera() {
    let hostname = "";
    let security = false;
    
    safeUpdateElement("hostnameInput", (element) => {
        hostname = element.value;
    });
    
    safeUpdateElement("secureCheckbox", (element) => {
        security = element.checked;
    });

    try {
        // Check if the hostname is valid
        let response = sendRequest("GET", (security ? "https://" : "http://")+hostname+"/control/api/v1/system","");

        if (response.status < 300) {
            // Success, make a new camera, get all relevant info, and populate the UI
            cameras[ci] = new BMCamera(hostname, security);
            // Save camera hostname and security status in local storage
            localStorage.setItem("camerahostname_"+ci, hostname);
            localStorage.setItem("camerasecurity_"+ci, security);
            cameras[ci].updateUI = updateUIAll;
            cameras[ci].active = true;

            safeUpdateElement("connectionErrorSpan", (element) => {
                element.innerHTML = "Connected.";
                element.setAttribute("style","color: #6e6e6e;");
            });
        } else {
            safeUpdateElement("connectionErrorSpan", (element) => {
                element.innerHTML = response.statusText;
            });
        }
    } catch (error) {
        safeUpdateElement("connectionErrorSpan", (element) => {
            element.title = error;
            element.innerHTML = `Error ${error.code}: ${error.name} (Your hostname is probably incorrect, hover for more details)`;
        });
    }

    unsavedChanges = unsavedChanges.filter((e) => {return e !== "Hostname"});
}

// Automatically connects to all 8 Bones cameras (bmcamera1.local to bmcamera8.local)
function connectBonesCameras() {
    let security = document.getElementById("secureCheckbox").checked;
    let currentCi = ci; // Save current camera index
    let successCount = 0;

    console.log('Starting connection process to all Bones cameras...');
    console.log(`HTTPS ${security ? 'enabled' : 'disabled'}`);

    // Try to connect to each camera
    for (let i = 0; i < 8; i++) {
        ci = i; // Set camera index
        let hostname = `bmcamera${i+1}.local`;
        console.log(`[Camera ${i+1}] Attempting to connect to ${hostname}...`);

        try {
            // Check if the hostname is valid
            let response = sendRequest("GET", (security ? "https://" : "http://")+hostname+"/control/api/v1/system","");

            if (response.status < 300) {
                // Success, make a new camera, get all relevant info, and populate the UI
                cameras[i] = new BMCamera(hostname, security);
                // Save camera hostname and security status in local storage
                localStorage.setItem("camerahostname_"+i, hostname);
                localStorage.setItem("camerasecurity_"+i, security);
                cameras[i].updateUI = updateUIAll;
                cameras[i].active = true;
                successCount++;
                console.log(`[Camera ${i+1}] Successfully connected to ${hostname}`);
                console.log(`[Camera ${i+1}] Camera info:`, response);
            } else {
                console.log(`[Camera ${i+1}] Failed to connect to ${hostname} - Status: ${response.status} ${response.statusText}`);
                document.getElementById("connectionErrorSpan").title = error;
                document.getElementById("connectionErrorSpan").innerHTML = response.statusText;
            }
        } catch (error) {
            console.log(`[Camera ${i+1}] Failed to connect to ${hostname}:`, error);
            document.getElementById("connectionErrorSpan").title = error;
            document.getElementById("connectionErrorSpan").innerHTML = `Error ${error.code}: ${error.name} (Your hostname is probably incorrect, hover for more details)`;
        }
    }

    // Restore original camera index and update UI
    ci = currentCi;
    console.log(`\nConnection process completed.\nSuccessfully connected to ${successCount} out of 8 cameras.`);
    
    if (successCount > 0) {
        document.getElementById("connectionErrorSpan").innerHTML = `Connected ${successCount}/8 cameras.`;
        document.getElementById("connectionErrorSpan").setAttribute("style","color: #6e6e6e;");
    }
}

// =============================== Presets Handler ================================

// Saves current camera settings as a preset
async function savePreset() {
    if (!cameras[ci] || !cameras[ci].active) {
        alert('No active camera selected!');
        return;
    }

    const presetName = document.getElementById('presetNameInput').value.trim();
    if (!presetName) {
        alert('Please enter a preset name!');
        return;
    }

    // Get current camera settings based on configuration
    const settings = {};
    const cam = cameras[ci];
    
    // Helper function to safely get data from an endpoint
    function safeGETdata(endpoint) {
        try {
            const data = cam.GETdata(endpoint);
            if (data && data.status !== 404) {
                return data;
            }
        } catch (error) {
            console.log(`Endpoint ${endpoint} not available:`, error);
        }
        return null;
    }
    
    // Video settings
    if (PRESET_CONFIG.focus) {
        const focusData = safeGETdata('/lens/focus');
        if (focusData) settings.focus = focusData;
    }
    if (PRESET_CONFIG.autoFocus) {
        const autoFocusData = safeGETdata('/lens/autoFocus');
        if (autoFocusData) settings.autoFocus = autoFocusData;
    }
    if (PRESET_CONFIG.iris) {
        const irisData = safeGETdata('/lens/aperture');
        if (irisData) settings.iris = irisData;
    }
    if (PRESET_CONFIG.gain) {
        const gainData = safeGETdata('/video/gain');
        if (gainData) settings.gain = gainData;
    }
    if (PRESET_CONFIG.shutter) {
        const shutterData = safeGETdata('/video/shutter');
        if (shutterData) settings.shutter = shutterData;
    }
    if (PRESET_CONFIG.whiteBalance) {
        const wbData = safeGETdata('/video/whiteBalance');
        const wbTintData = safeGETdata('/video/whiteBalanceTint');
        if (wbData && wbTintData) {
            settings.whiteBalance = {
                value: wbData.whiteBalance,
                tint: wbTintData.whiteBalanceTint
            };
        }
    }
    if (PRESET_CONFIG.ndFilter) {
        const ndData = safeGETdata('/video/ndFilter');
        if (ndData) settings.ndFilter = ndData;
    }

    // Color settings
    if (PRESET_CONFIG.colorCorrection.enabled) {
        settings.colorCorrection = {};
        if (PRESET_CONFIG.colorCorrection.lift) {
            const liftData = safeGETdata('/colorCorrection/lift');
            if (liftData) settings.colorCorrection.lift = liftData;
        }
        if (PRESET_CONFIG.colorCorrection.gamma) {
            const gammaData = safeGETdata('/colorCorrection/gamma');
            if (gammaData) settings.colorCorrection.gamma = gammaData;
        }
        if (PRESET_CONFIG.colorCorrection.gain) {
            const gainData = safeGETdata('/colorCorrection/gain');
            if (gainData) settings.colorCorrection.gain = gainData;
        }
        if (PRESET_CONFIG.colorCorrection.offset) {
            const offsetData = safeGETdata('/colorCorrection/offset');
            if (offsetData) settings.colorCorrection.offset = offsetData;
        }
    }
    if (PRESET_CONFIG.contrast) {
        const contrastData = safeGETdata('/colorCorrection/contrast');
        if (contrastData) settings.contrast = contrastData;
    }
    if (PRESET_CONFIG.color) {
        const colorData = safeGETdata('/colorCorrection/color');
        const lumaData = safeGETdata('/colorCorrection/lumaContribution');
        if (colorData && lumaData) {
            settings.color = {
                hue: colorData.hue,
                saturation: colorData.saturation,
                lumaContribution: lumaData.lumaContribution
            };
        }
    }

    // Other settings
    if (PRESET_CONFIG.autoExposure) {
        settings.autoExposure = cameras[ci].GETdata('/video/autoExposure');
    }

    const currentSettings = {
        name: presetName,
        timestamp: new Date().toISOString(),
        settings: settings
    };

    try {
        // Create a Blob containing the preset data
        const presetBlob = new Blob([JSON.stringify(currentSettings, null, 2)], {
            type: 'application/json'
        });

        // Create a download link and trigger it
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(presetBlob);
        downloadLink.download = presetName + '.json';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        // Clear input
        document.getElementById('presetNameInput').value = '';
        console.log('Preset saved successfully:', presetName);
    } catch (error) {
        console.error('Error saving preset:', error);
        alert('Failed to save preset: ' + error.message);
    }
}

// Load preset from a file
// Copy current camera settings to memory
function copyCurrentPreset() {
    if (!cameras[ci] || !cameras[ci].active) {
        console.warn('No active camera selected');
        safeUpdateElement("presetStatusSpan", (element) => {
            element.innerHTML = "Error: No active camera selected";
            element.style.color = "#ff0000";
        });
        return;
    }
    
    try {
        copiedPreset = {};
        let settingsCopied = 0;
        
        // Helper function to safely add a property to the preset
        function addToPreset(key, path) {
            const value = getSafeProperty(path);
            if (value !== null) {
                // For nested objects, create them if they don't exist
                const keys = key.split('.');
                let current = copiedPreset;
                
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!current[keys[i]]) {
                        current[keys[i]] = {};
                    }
                    current = current[keys[i]];
                }
                
                current[keys[keys.length - 1]] = value;
                settingsCopied++;
                return true;
            }
            return false;
        }
        
        // Copy all enabled settings
        if (PRESET_CONFIG.focus) addToPreset('focus', '/lens/focus');
        if (PRESET_CONFIG.autoFocus) addToPreset('autoFocus', '/lens/autoFocus');
        if (PRESET_CONFIG.iris) addToPreset('iris', '/lens/iris');
        if (PRESET_CONFIG.gain) addToPreset('gain', '/video/gain');
        if (PRESET_CONFIG.shutter) addToPreset('shutter', '/video/shutter');
        if (PRESET_CONFIG.whiteBalance) {
            addToPreset('whiteBalance', '/video/whiteBalance');
            addToPreset('whiteBalanceTint', '/video/whiteBalanceTint');
        }
        if (PRESET_CONFIG.ndFilter) addToPreset('ndFilter', '/video/ndFilter');
        
        // Handle color correction
        if (PRESET_CONFIG.colorCorrection.enabled) {
            if (PRESET_CONFIG.colorCorrection.lift) addToPreset('colorCorrection.lift', '/colorCorrection/lift');
            if (PRESET_CONFIG.colorCorrection.gamma) addToPreset('colorCorrection.gamma', '/colorCorrection/gamma');
            if (PRESET_CONFIG.colorCorrection.gain) addToPreset('colorCorrection.gain', '/colorCorrection/gain');
            if (PRESET_CONFIG.colorCorrection.offset) addToPreset('colorCorrection.offset', '/colorCorrection/offset');
        }
        
        if (PRESET_CONFIG.contrast) addToPreset('contrast', '/colorCorrection/contrast');
        
        if (PRESET_CONFIG.color) {
            addToPreset('color', '/colorCorrection/color');
            addToPreset('lumaContribution', '/colorCorrection/lumaContribution');
        }
        
        if (PRESET_CONFIG.autoExposure) addToPreset('autoExposure', '/video/autoExposure');

        // Check if any settings were copied
        if (settingsCopied === 0) {
            throw new Error('No settings were available to copy');
        }

        console.log(`Copied ${settingsCopied} settings successfully`, copiedPreset);
        safeUpdateElement("presetStatusSpan", (element) => {
            element.innerHTML = `Copied ${settingsCopied} settings to preset`;
            element.style.color = "#6e6e6e";
        });

    } catch (error) {
        console.error('Error copying settings:', error);
        safeUpdateElement("presetStatusSpan", (element) => {
            element.innerHTML = `Error: ${error.message}`;
            element.style.color = "#ff0000";
        });
    }
}

// Paste copied settings to current camera
function pastePreset() {
    if (!cameras[ci] || !cameras[ci].active) {
        console.warn('No active camera selected');
        return;
    }

    if (!copiedPreset) {
        console.warn('No settings copied yet');
        return;
    }

    try {
        // Helper function to safely send PUT requests
        function safePUTdata(endpoint, data) {
            if (!data) return;
            try {
                const response = cameras[ci].PUTdata(endpoint, data);
                if (response.status >= 300) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            } catch (error) {
                if (error.message.includes('CORS')) {
                    console.warn(`CORS error for ${endpoint} - expected if running locally`);
                } else {
                    throw error;
                }
            }
        }

        // Apply settings based on what was copied
        if (copiedPreset.focus) safePUTdata('/lens/focus', copiedPreset.focus);
        if (copiedPreset.autoFocus) safePUTdata('/lens/autoFocus', copiedPreset.autoFocus);
        if (copiedPreset.iris) safePUTdata('/lens/iris', copiedPreset.iris);
        if (copiedPreset.gain) safePUTdata('/video/gain', copiedPreset.gain);
        if (copiedPreset.shutter) safePUTdata('/video/shutter', copiedPreset.shutter);
        if (copiedPreset.whiteBalance) {
            safePUTdata('/video/whiteBalance', copiedPreset.whiteBalance);
            if (copiedPreset.whiteBalanceTint) {
                safePUTdata('/video/whiteBalanceTint', copiedPreset.whiteBalanceTint);
            }
        }
        if (copiedPreset.ndFilter) safePUTdata('/video/ndFilter', copiedPreset.ndFilter);
        
        if (copiedPreset.colorCorrection) {
            const cc = copiedPreset.colorCorrection;
            if (cc.lift) safePUTdata('/colorCorrection/lift', cc.lift);
            if (cc.gamma) safePUTdata('/colorCorrection/gamma', cc.gamma);
            if (cc.gain) safePUTdata('/colorCorrection/gain', cc.gain);
            if (cc.offset) safePUTdata('/colorCorrection/offset', cc.offset);
        }

        console.log('Settings applied successfully');
        safeUpdateElement('statusMessage', el => {
            el.textContent = 'Settings applied successfully';
            el.style.color = '#4CAF50';
        });
        
        // Update UI after applying settings
        setTimeout(updateUIAll, 100);
    } catch (error) {
        console.error('Error applying settings:', error);
        safeUpdateElement('statusMessage', el => {
            el.textContent = 'Error applying settings: ' + error.message;
            el.style.color = '#f44336';
        });
    }
}

async function loadPresetFile(file) {
    if (!file) {
        console.warn('No file selected');
        return;
    }
    if (!cameras[ci] || !cameras[ci].active) {
        console.warn('No active camera selected');
        return;
    }

    try {
        // Helper function to safely send PUT requests
        function safePUTdata(endpoint, data) {
            if (!data) return;
            try {
                const response = cameras[ci].PUTdata(endpoint, data);
                if (response.status >= 300) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            } catch (error) {
                if (error.message.includes('CORS')) {
                    console.warn(`CORS error for ${endpoint} - expected if running locally`);
                } else {
                    throw error;
                }
            }
        }

        const preset = JSON.parse(await file.text());
        if (!preset) {
            throw new Error('Invalid preset file format');
        }

        // Apply settings based on configuration
        if (PRESET_CONFIG.focus && preset.focus) {
            safePUTdata('/lens/focus', preset.focus);
        }
        if (PRESET_CONFIG.autoFocus && preset.autoFocus) {
            safePUTdata('/lens/autoFocus', preset.autoFocus);
        }
        if (PRESET_CONFIG.iris && preset.iris) {
            safePUTdata('/lens/iris', preset.iris);
        }
        if (PRESET_CONFIG.gain && preset.gain) {
            safePUTdata('/video/gain', preset.gain);
        }
        if (PRESET_CONFIG.shutter && preset.shutter) {
            safePUTdata('/video/shutter', preset.shutter);
        }
        if (PRESET_CONFIG.whiteBalance && preset.whiteBalance) {
            safePUTdata('/video/whiteBalance', preset.whiteBalance);
            if (preset.whiteBalanceTint) {
                safePUTdata('/video/whiteBalanceTint', preset.whiteBalanceTint);
            }
        }
        if (PRESET_CONFIG.ndFilter && preset.ndFilter) {
            safePUTdata('/video/ndFilter', preset.ndFilter);
        }

        if (PRESET_CONFIG.colorCorrection.enabled && preset.colorCorrection) {
            const cc = preset.colorCorrection;
            if (PRESET_CONFIG.colorCorrection.lift && cc.lift) {
                safePUTdata('/colorCorrection/lift', cc.lift);
            }
            if (PRESET_CONFIG.colorCorrection.gamma && cc.gamma) {
                safePUTdata('/colorCorrection/gamma', cc.gamma);
            }
            if (PRESET_CONFIG.colorCorrection.gain && cc.gain) {
                safePUTdata('/colorCorrection/gain', cc.gain);
            }
            if (PRESET_CONFIG.colorCorrection.offset && cc.offset) {
                safePUTdata('/colorCorrection/offset', cc.offset);
            }
        }

        console.log('Preset loaded successfully:', file.name);
        safeUpdateElement('statusMessage', el => {
            el.textContent = 'Preset loaded successfully';
            el.style.color = '#4CAF50';
        });

        // Update UI after applying settings
        setTimeout(updateUIAll, 100);
    } catch (error) {
        console.error('Error loading preset:', error);
        safeUpdateElement('statusMessage', el => {
            el.textContent = 'Error loading preset: ' + error.message;
            el.style.color = '#f44336';
        });
    } finally {
        // Reset the file input so the same file can be loaded again
    }
}

function pastePreset() {
    if (!cameras[ci] || !cameras[ci].active) {
        console.warn('No active camera selected');
        return;
    }
    if (!copiedPreset) {
        console.warn('No settings copied yet');
        return;
    }
    try {
        function safePUTdata(endpoint, data) {
            if (!data) return;
            try {
                const response = cameras[ci].PUTdata(endpoint, data);
                if (response.status >= 300) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            } catch (error) {
                if (error.message.includes('CORS')) {
                    console.warn(`CORS error for ${endpoint} - expected if running locally`);
                } else {
                    throw error;
                }
            }
        }

        // Apply settings based on PRESET_CONFIG
        if (PRESET_CONFIG.focus && copiedPreset.focus) {
            safePUTdata('/lens/focus', copiedPreset.focus);
        }
        if (PRESET_CONFIG.autoFocus && copiedPreset.autoFocus) {
            safePUTdata('/lens/autoFocus', copiedPreset.autoFocus);
        }
        if (PRESET_CONFIG.iris && copiedPreset.iris) {
            safePUTdata('/lens/iris', copiedPreset.iris);
        }
        if (PRESET_CONFIG.gain && copiedPreset.gain) {
            safePUTdata('/video/gain', copiedPreset.gain);
        }
        if (PRESET_CONFIG.shutter && copiedPreset.shutter) {
            safePUTdata('/video/shutter', copiedPreset.shutter);
        }
        if (PRESET_CONFIG.whiteBalance) {
            if (copiedPreset.whiteBalance) safePUTdata('/video/whiteBalance', copiedPreset.whiteBalance);
            if (copiedPreset.whiteBalanceTint) safePUTdata('/video/whiteBalanceTint', copiedPreset.whiteBalanceTint);
        }
        if (PRESET_CONFIG.ndFilter && copiedPreset.ndFilter) {
            safePUTdata('/video/ndFilter', copiedPreset.ndFilter);
        }
        if (PRESET_CONFIG.colorCorrection.enabled && copiedPreset.colorCorrection) {
            if (PRESET_CONFIG.colorCorrection.lift && copiedPreset.colorCorrection.lift) {
                safePUTdata('/colorCorrection/lift', copiedPreset.colorCorrection.lift);
            }
            if (PRESET_CONFIG.colorCorrection.gamma && copiedPreset.colorCorrection.gamma) {
                safePUTdata('/colorCorrection/gamma', copiedPreset.colorCorrection.gamma);
            }
            if (PRESET_CONFIG.colorCorrection.gain && copiedPreset.colorCorrection.gain) {
                safePUTdata('/colorCorrection/gain', copiedPreset.colorCorrection.gain);
            }
            if (PRESET_CONFIG.colorCorrection.offset && copiedPreset.colorCorrection.offset) {
                safePUTdata('/colorCorrection/offset', copiedPreset.colorCorrection.offset);
            }
        }
        if (PRESET_CONFIG.contrast && copiedPreset.contrast) {
            safePUTdata('/colorCorrection/contrast', copiedPreset.contrast);
        }
        if (PRESET_CONFIG.color) {
            if (copiedPreset.color) safePUTdata('/colorCorrection/color', copiedPreset.color);
            if (copiedPreset.lumaContribution) safePUTdata('/colorCorrection/lumaContribution', copiedPreset.lumaContribution);
        }
        if (PRESET_CONFIG.autoExposure && copiedPreset.autoExposure) {
            safePUTdata('/video/autoExposure', copiedPreset.autoExposure);
        }

        console.log('Settings applied successfully');
        safeUpdateElement("presetStatusSpan", (element) => {
            element.innerHTML = "Settings applied successfully.";
            element.style.color = "#6e6e6e";
        });

        // Update UI after a short delay to allow camera state to update
        setTimeout(updateUIAll, 100);

    } catch (error) {
        console.error('Error applying settings:', error);
        safeUpdateElement("presetStatusSpan", (element) => {
            element.innerHTML = "Error applying settings: " + error.message;
            element.style.color = "#ff0000";
        });
    }
}

// =============================== UI Updater ==================================
// =============================================================================

function updateUIAll() {
    if (!cameras[ci]) return;

    // Helper function to safely update element
    function safeUpdateElement(id, updateFn) {
        const element = document.getElementById(id);
        if (element) updateFn(element);
    }

    // ========== Camera Name ==========
    safeUpdateElement("cameraName", el => el.innerHTML = cameras[ci].name);

    // ========== Hostname ==========
    if (!unsavedChanges.includes("Hostname")) {
        safeUpdateElement("hostnameInput", el => el.value = cameras[ci].hostname);
    }

    // ========== Format ==========
    const formatData = cameras[ci].propertyData['/system/format'];
    if (formatData) {
        safeUpdateElement("formatCodec", el => {
            if (formatData.codec) {
                el.innerHTML = formatData.codec.toUpperCase().replace(":"," ").replace("_",":");
            }
        });
        
        safeUpdateElement("formatResolution", el => {
            const resObj = formatData.recordResolution;
            if (resObj?.width && resObj?.height) {
                el.innerHTML = resObj.width + "x" + resObj.height;
            }
        });

        safeUpdateElement("formatFPS", el => {
            if (formatData.frameRate) {
                el.innerHTML = formatData.frameRate + " fps";
            }
        });
    }

    // ========== Recording State ==========
    const recordingState = cameras[ci].propertyData['/transports/0/state']?.state;
    if (recordingState) {
        ['cameraControlHeadContainer', 'cameraControlExpandedHeadContainer'].forEach(id => {
            safeUpdateElement(id, el => {
                if (recordingState === 'record') {
                    el.classList.add('liveCam');
                } else {
                    el.classList.remove('liveCam');
                }
            });
        });
    }

    // ========== Playback Loop State ==========
    const playbackData = cameras[ci].propertyData['/transports/0/playback'];
    if (playbackData) {
        safeUpdateElement('loopButton', el => {
            if (playbackData.loop) {
                el.classList.add('activated');
            } else {
                el.classList.remove('activated');
            }
        });
    }

    safeUpdateElement('singleClipButton', el => {
        if (playbackData?.singleClip) {
            el.classList.add('activated');
        } else {
            el.classList.remove('activated');
        }
    });

    // ========== Timecode ==========
    safeUpdateElement("timecodeLabel", el => {
        const timecode = cameras[ci].propertyData['/transports/0/timecode']?.timecode;
        if (timecode) el.innerHTML = parseTimecode(timecode);
    });

    // ========== Presets Dropdown ==========

    if (!unsavedChanges.includes("presets")) {
        safeUpdateElement("presetsDropDown", el => {
            el.innerHTML = "";
            
            const presets = cameras[ci].propertyData['/presets']?.presets;
            if (presets) {
                presets.forEach((presetItem) => {
                    let presetName = presetItem.split('.', 1);
                    let textNode = document.createTextNode(presetName);
                    let optionNode = document.createElement("option");
                    optionNode.setAttribute("name", "presetOption"+presetName);
                    optionNode.appendChild(textNode);
                    el.appendChild(optionNode);
                });
            }
        });

    // ========== Active Preset ==========
        safeUpdateElement("presetsDropDown", el => {
            const activePreset = cameras[ci].propertyData['/presets/active']?.preset;
            if (activePreset) {
                el.childNodes.forEach((child) => {
                    if (child.nodeName == 'OPTION') {
                        child.selected = (child.value + ".cset") === activePreset;
                    }
                });
            }
        });

    }

    // ========== Iris ==========
    const irisData = cameras[ci].propertyData['/lens/iris'];
    safeUpdateElement('irisRange', el => {
        if (irisData?.normalised !== undefined) el.value = irisData.normalised;
    });
    safeUpdateElement('apertureStopsLabel', el => {
        if (irisData?.apertureStop !== undefined) el.innerHTML = irisData.apertureStop.toFixed(1);
    });

    // ========== Zoom ==========
    const zoomData = cameras[ci].propertyData['/lens/zoom'];
    safeUpdateElement('zoomRange', el => {
        if (zoomData?.normalised !== undefined) el.value = zoomData.normalised;
    });
    safeUpdateElement('zoomMMLabel', el => {
        if (zoomData?.focalLength !== undefined) el.innerHTML = zoomData.focalLength + 'mm';
    });

    // ========== Focus ==========
    const focusData = cameras[ci].propertyData['/lens/focus'];
    safeUpdateElement('focusRange', el => {
        if (focusData?.normalised !== undefined) el.value = focusData.normalised;
    });

    // ========== ISO ==========
    if (!unsavedChanges.includes('ISO')) {
        safeUpdateElement('ISOInput', el => {
            const isoValue = cameras[ci].propertyData['/video/iso']?.iso;
            if (isoValue !== undefined) el.value = isoValue;
        });
    }

    // ========== GAIN ==========
    if (!unsavedChanges.includes('Gain')) {
        safeUpdateElement('gainSpan', el => {
            const gainInt = cameras[ci].propertyData['/video/gain']?.gain;
            if (gainInt !== undefined) {
                el.innerHTML = (gainInt >= 0 ? '+' : '') + gainInt + 'db';
            }
        });
    }

    // ========== WHITE BALANCE ===========
    if (!unsavedChanges.includes('WB')) {
        safeUpdateElement('whiteBalanceSpan', el => {
            const wb = cameras[ci].propertyData['/video/whiteBalance']?.whiteBalance;
            if (wb !== undefined) el.innerHTML = wb + 'K';
        });
    }
    
    if (!unsavedChanges.includes('WBT')) {
        safeUpdateElement('whiteBalanceTintSpan', el => {
            const wbt = cameras[ci].propertyData['/video/whiteBalanceTint']?.whiteBalanceTint;
            if (wbt !== undefined) el.innerHTML = wbt;
        });
    }

    // =========== ND =============
    if (!unsavedChanges.includes('ND')) {
        safeUpdateElement('ndFilterSpan', el => {
            const ndFilter = cameras[ci].propertyData['/video/ndFilter'];
            if (ndFilter?.stop !== undefined) {
                el.innerHTML = ndFilter.stop;
                el.disabled = false;
            } else {
                el.innerHTML = '0';
                el.disabled = true;
            }
        });
    }

    // ============ Shutter =====================
    if (!unsavedChanges.includes('Shutter')) {
        safeUpdateElement('shutterSpan', el => {
            const shutterObj = cameras[ci].propertyData['/video/shutter'];
            let shutterString = 'SS';

            if (shutterObj?.shutterSpeed) {
                shutterString = '1/' + shutterObj.shutterSpeed;
            } else if (shutterObj?.shutterAngle) {
                const shangleString = (shutterObj.shutterAngle / 100).toFixed(1);
                shutterString = shangleString.endsWith('.0') ? 
                    parseFloat(shangleString).toFixed(0) + '°' : 
                    shangleString + '°';
            }

            el.innerHTML = shutterString;
        });
    }

    // =========== Auto Exposure Mode ===========
    if (!unsavedChanges.includes('AutoExposure')) {
        const autoExposure = cameras[ci].propertyData['/video/autoExposure'];
        safeUpdateElement('AEmodeDropDown', el => {
            if (autoExposure?.mode !== undefined) el.value = autoExposure.mode;
        });
        safeUpdateElement('AEtypeDropDown', el => {
            if (autoExposure?.type !== undefined) el.value = autoExposure.type;
        });
    }

    // =========== COLOR CORRECTION =============
    if (!unsavedChanges.includes('ColorCorrection')) {
        const colorCorrectionObj = cameras[ci].propertyData['/video/colorCorrection'];
        
        // Helper function to update color correction values
        const updateColorValue = (id, value) => {
            safeUpdateElement(id, el => {
                if (value !== undefined) el.innerHTML = value.toFixed(2);
            });
        };

        // Update lift values
        ['red', 'green', 'blue', 'luma'].forEach(color => {
            updateColorValue(`lift${color.charAt(0).toUpperCase()}Span`, colorCorrectionObj?.lift?.[color]);
        });

        // Update gamma values
        ['red', 'green', 'blue', 'luma'].forEach(color => {
            updateColorValue(`gamma${color.charAt(0).toUpperCase()}Span`, colorCorrectionObj?.gamma?.[color]);
        });

        // Update gain values
        ['red', 'green', 'blue', 'luma'].forEach(color => {
            updateColorValue(`gain${color.charAt(0).toUpperCase()}Span`, colorCorrectionObj?.gain?.[color]);
        });

        // Update offset values
        ['red', 'green', 'blue', 'luma'].forEach(color => {
            updateColorValue(`offset${color.charAt(0).toUpperCase()}Span`, colorCorrectionObj?.offset?.[color]);
        });

        // Update other color correction values
        updateColorValue('contrastSpan', colorCorrectionObj?.contrast);
        updateColorValue('contrastPivotSpan', colorCorrectionObj?.pivot);
        updateColorValue('saturationSpan', colorCorrectionObj?.saturation);
        updateColorValue('hueSpan', colorCorrectionObj?.hue);
        updateColorValue('lumaContributionSpan', colorCorrectionObj?.lumaMix);
    }

    // Contrast
    if (!unsavedChanges.includes("CC4")) {
        const constrastProps = cameras[ci].propertyData['/colorCorrection/contrast'];
        if (constrastProps) {
            safeUpdateElement("CCcontrastPivotRange", el => el.value = constrastProps.pivot);
            safeUpdateElement("CCcontrastPivotLabel", el => el.innerHTML = constrastProps.pivot?.toFixed(2));
            safeUpdateElement("CCcontrastAdjustRange", el => el.value = constrastProps.adjust);
            safeUpdateElement("CCcontrastAdjustLabel", el => el.innerHTML = parseInt(constrastProps.adjust * 50) + "%");
        }
    }
    
    // Color
    if (!unsavedChanges.includes("CC5")) {
        const colorProps = cameras[ci].propertyData['/colorCorrection/color'];
        if (colorProps) {
            safeUpdateElement("CChueRange", el => el.value = colorProps.hue);
            safeUpdateElement("CCcolorHueLabel", el => el.innerHTML = parseInt((colorProps.hue + 1) * 180) + "°");
            safeUpdateElement("CCsaturationRange", el => el.value = colorProps.saturation);
            safeUpdateElement("CCcolorSatLabel", el => el.innerHTML = parseInt(colorProps.saturation * 50) + "%");
        }

        const lumaContributionProps = cameras[ci].propertyData['/colorCorrection/lumaContribution'];
        if (lumaContributionProps) {
            safeUpdateElement("CClumaContributionRange", el => el.value = lumaContributionProps.lumaContribution);
            safeUpdateElement("CCcolorLCLabel", el => el.innerHTML = parseInt(lumaContributionProps.lumaContribution * 100) + "%");
        }
    }

    // ============ Footer Links ===============
    const protocol = cameras[ci].useHTTPS ? 'https://' : 'http://';
    const baseUrl = protocol + cameras[ci].hostname;
    
    safeUpdateElement('documentationLink', el => el.href = baseUrl + '/control/documentation.html');
    safeUpdateElement('mediaManagerLink', el => el.href = baseUrl);
}


// ==============================================================================

// Called when the user changes tabs to a different camera
function switchCamera(index) {
    if (cameras[ci]) {
        cameras[ci].active = false;
    }

    ci = index;

    // Reset the Controls
    safeUpdateElement("allCamerasContainer", el => el.innerHTML = defaultControlsHTML);

    // Update camera switch labels
    const switchLabels = document.getElementsByClassName("cameraSwitchLabel");
    for (var i = 0; i < 8; i++) {
        if (switchLabels[i]) {
            if (i == ci) {
                switchLabels[i].classList.add("selectedCam");
            } else {
                switchLabels[i].classList.remove("selectedCam");
            }
        }
    }

    safeUpdateElement("cameraNumberLabel", el => el.innerHTML = "CAM" + (ci+1));
    safeUpdateElement("cameraName", el => el.innerHTML = "CAMERA NAME");
    safeUpdateElement("hostnameInput", el => el.value = localStorage.getItem("camerahostname_" + ci.toString()));
    safeUpdateElement("secureCheckbox", el => {
        if (localStorage.getItem("camerasecurity_" + ci.toString()) === 'true') {
            el.checked = true;
        }
    });    
    if (cameras[ci]) {
        cameras[ci].active = true;
    }

    // No need to update presets list anymore as we're using file-based presets
}

// For not-yet-implemented Color Correction UI
function setCCMode(mode) {
    if (mode == 0) {
        // Lift

    } else if (mode == 1) {
        // Gamma

    } else {
        // Gain

    }

    for (var i = 0; i < 3; i++) {
        if (i == mode) {
            document.getElementsByClassName("ccTabLabel")[i].classList.add("selectedTab");
        } else {
            document.getElementsByClassName("ccTabLabel")[i].classList.remove("selectedTab");
        }
    }
}

// Allows for changing WB/Tint displayed in the UI
function swapWBMode() {
    if (WBMode == 0) {
        // Balance
        document.getElementById("WBLabel").innerHTML = "TINT";
        document.getElementById("WBValueContainer").classList.add("dNone");
        document.getElementById("WBTintValueContainer").classList.remove("dNone");
        
        WBMode = 1;
    } else {
        //Tint
        document.getElementById("WBLabel").innerHTML = "BALANCE";
        document.getElementById("WBValueContainer").classList.remove("dNone");
        document.getElementById("WBTintValueContainer").classList.add("dNone");

        WBMode = 0;
    }
}

// Triggered by the button by those text boxes. Reads the info from the inputs and sends it to the camera.
function manualAPICall() {
    const requestRadioGET = document.getElementById("requestTypeGET");

    const requestEndpointText = document.getElementById("manualRequestEndpointLabel").value;
    let requestData = "";

    try {
        requestData = JSON.parse(document.getElementById("manualRequestBodyLabel").value);
    } catch (err) {
        document.getElementById("manualRequestResponseP").innerHTML = err;
    }

    const requestMethod = (requestRadioGET.checked ? "GET" : "PUT");
    const requestURL = cameras[ci].APIAddress+requestEndpointText;

    let response = sendRequest(requestMethod,requestURL,requestData);
    
    document.getElementById("manualRequestResponseP").innerHTML = JSON.stringify(response);
}

/*  Control Calling Functions   */
/*    Makes the HTML cleaner.   */

function decreaseND() {
    cameras[ci].PUTdata("/video/ndFilter",{stop: cameras[ci].propertyData['/video/ndFilter'].stop-2});
}

function increaseND() {
    cameras[ci].PUTdata("/video/ndFilter",{stop: cameras[ci].propertyData['/video/ndFilter'].stop+2});
}

function decreaseGain() {
    cameras[ci].PUTdata("/video/gain",{gain: cameras[ci].propertyData['/video/gain'].gain-2});
}

function increaseGain() {
    cameras[ci].PUTdata("/video/gain",{gain: cameras[ci].propertyData['/video/gain'].gain+2});
}

function decreaseShutter() {
    let cam = cameras[ci];

    if ('shutterSpeed' in cam.propertyData['/video/shutter']) {
        cam.PUTdata("/video/shutter", {"shutterSpeed": cam.propertyData['/video/shutter'].shutterSpeed+10});
    } else {
        cam.PUTdata("/video/shutter", {"shutterAngle": cam.propertyData['/video/shutter'].shutterAngle-1000});
    }
}

function increaseShutter() {
    let cam = cameras[ci];

    if ('shutterSpeed' in cam.propertyData['/video/shutter']) {
        cam.PUTdata("/video/shutter", {"shutterSpeed": cam.propertyData['/video/shutter'].shutterSpeed-10});
    } else {
        cam.PUTdata("/video/shutter", {"shutterAngle": cam.propertyData['/video/shutter'].shutterAngle+1000});
    }
}

function handleShutterInput() {
    let inputString = document.getElementById("shutterSpan").innerHTML;

    if (event.key === 'Enter') {
        let cam = cameras[ci];

        if ('shutterSpeed' in cam.propertyData['/video/shutter']) {
            if (inputString.indexOf("1/") >= 0) {
                cam.PUTdata("/video/shutter", {"shutterSpeed" :parseInt(inputString.substring(2))});
            } else {
                cam.PUTdata("/video/shutter", {"shutterSpeed" :parseInt(inputString)});
            }
            
        } else {
            cam.PUTdata("/video/shutter", {"shutterAngle": parseInt(parseFloat(inputString)*100)});
        }
        
        unsavedChanges = unsavedChanges.filter((e) => {return e !== "Shutter"});
    } else {
        unsavedChanges.push('Shutter');
    }
}

function decreaseWhiteBalance() {
    cameras[ci].PUTdata("/video/whiteBalance", {whiteBalance: cameras[ci].propertyData['/video/whiteBalance'].whiteBalance-50});
}

function increaseWhiteBalance() {
    cameras[ci].PUTdata("/video/whiteBalance", {whiteBalance: cameras[ci].propertyData['/video/whiteBalance'].whiteBalance+50});
}

function decreaseWhiteBalanceTint() {
    cameras[ci].PUTdata("/video/whiteBalanceTint", {whiteBalanceTint: cameras[ci].propertyData['/video/whiteBalanceTint'].whiteBalanceTint-1});
}

function increaseWhiteBalanceTint() {
    cameras[ci].PUTdata("/video/whiteBalanceTint", {whiteBalanceTint: cameras[ci].propertyData['/video/whiteBalanceTint'].whiteBalanceTint+1});
}

function presetInputHandler() {
    let selectedPreset = document.getElementById("presetsDropDown").value;

    cameras[ci].PUTdata("/presets/active", {preset: selectedPreset+".cset"});

    unsavedChanges = unsavedChanges.filter((e) => {return e !== "presets"});
}

function hostnameInputHandler() {
    let newHostname = document.getElementById("hostnameInput").value;
    
    if (event.key === 'Enter') {
        event.preventDefault;
        unsavedChanges = unsavedChanges.filter((e) => {return e !== "Hostname"});
        initCamera();
    } else {
        unsavedChanges.push('Hostname');
    }
}

function AEmodeInputHandler() {
    let AEmode = document.getElementById("AEmodeDropDown").value;
    let AEtype = document.getElementById("AEtypeDropDown").value;

    cameras[ci].PUTdata("/video/autoExposure", {mode: AEmode, type: AEtype});

    unsavedChanges = unsavedChanges.filter((e) => {return e !== "AutoExposure"});
}

function ISOInputHandler() {
    let ISOInput = document.getElementById("ISOInput");

    if (event.key === 'Enter') {
        event.preventDefault;
        cameras[ci].PUTdata("/video/iso", {iso: parseInt(ISOInput.value)})
        unsavedChanges = unsavedChanges.filter((e) => {return e !== "ISO"});
    } else {
        unsavedChanges.push('ISO');
    }
}

// 0: lift, 1: gamma, 2: gain, 3: offset, 4: contrast, 5: color & LC
function CCInputHandler(which) {
    if (event.key === 'Enter') {
        event.preventDefault;
        setCCFromUI(which);
    } else {
        unsavedChanges.push('CC'+which);
    }
}

function NDFilterInputHandler() {
    if (event.key === 'Enter') {
        event.preventDefault;
        cameras[ci].PUTdata("/video/ndFilter", {stop: parseInt(document.getElementById("ndFilterSpan").innerHTML)})
        unsavedChanges = unsavedChanges.filter((e) => {return e !== "ND"});
    } else {
        unsavedChanges.push('ND');
    }
}

function GainInputHandler() {
    if (event.key === 'Enter') {
        event.preventDefault;
        cameras[ci].PUTdata("/video/gain", {gain: parseInt(document.getElementById("gainSpan").innerHTML)})
        unsavedChanges = unsavedChanges.filter((e) => {return e !== "Gain"});
    } else {
        unsavedChanges.push('Gain');
    }
}

function WBInputHandler() {
    if (!cameras[ci] || !cameras[ci].active) return;
    
    if (event.key === 'Enter') {
        event.preventDefault();
        try {
            const value = parseInt(document.getElementById("whiteBalanceSpan").innerHTML);
            cameras[ci].PUTdata("/video/whiteBalance", {"whiteBalance": value});
            unsavedChanges = unsavedChanges.filter((e) => {return e !== "WB"});
            updateUIAll();
        } catch (error) {
            console.error('Error updating white balance:', error);
        }
    } else {
        unsavedChanges.push('WB');
    }
}

function WBTInputHandler() {
    if (!cameras[ci] || !cameras[ci].active) return;
    
    if (event.key === 'Enter') {
        event.preventDefault();
        try {
            const value = parseInt(document.getElementById("whiteBalanceTintSpan").innerHTML);
            cameras[ci].PUTdata("/video/whiteBalanceTint", {"whiteBalanceTint": value});
            unsavedChanges = unsavedChanges.filter((e) => {return e !== "WBT"});
            updateUIAll();
        } catch (error) {
            console.error('Error updating white balance tint:', error);
        }
    } else {
        unsavedChanges.push('WBT');
    }
}

// 0: lift, 1: gamma, 2: gain, 3: offset
function setCCFromUI(which) {
    if (which < 4) {
        var lumaFloat = parseFloat(document.getElementsByClassName("CClumaLabel")[which].innerHTML);
        var redFloat = parseFloat(document.getElementsByClassName("CCredLabel")[which].innerHTML);
        var greenFloat = parseFloat(document.getElementsByClassName("CCgreenLabel")[which].innerHTML);
        var blueFloat = parseFloat(document.getElementsByClassName("CCblueLabel")[which].innerHTML);
        
        var ccobject = {"red": redFloat, "green": greenFloat, "blue": blueFloat, "luma": lumaFloat};
    }

    if (which == 0) {
        cameras[ci].PUTdata("/colorCorrection/lift", ccobject);
    } else if (which == 1) {
        cameras[ci].PUTdata("/colorCorrection/gamma", ccobject);
    } else if (which == 2) {
        cameras[ci].PUTdata("/colorCorrection/gain", ccobject);
    } else if (which == 3) {
        cameras[ci].PUTdata("/colorCorrection/offset", ccobject);
    } else if (which == 4) {
        let pivotFloat = parseFloat(document.getElementById("CCcontrastPivotLabel").innerHTML);
        let adjustInt = parseInt(document.getElementById("CCcontrastAdjustLabel").innerHTML);
        
        let adjustFloat = adjustInt/50.0;

        cameras[ci].PUTdata("/colorCorrection/contrast", {pivot: pivotFloat, adjust: adjustFloat});
    } else {
        let hueInt = parseInt(document.getElementById("CCcolorHueLabel").innerHTML);
        let satInt = parseInt(document.getElementById("CCcolorSatLabel").innerHTML);
        let lumCoInt = parseInt(document.getElementById("CCcolorLCLabel").innerHTML);
        
        let hueFloat = (hueInt/180.0) - 1.0;
        let satFloat = satInt/50.0;
        let lumCoFloat = lumCoInt/100.0;

        cameras[ci].PUTdata("/colorCorrection/color", {hue: hueFloat, saturation: satFloat});
        cameras[ci].PUTdata("/colorCorrection/lumaContribution", {lumaContribution: lumCoFloat});
    }

    unsavedChanges = unsavedChanges.filter((e) => {return !e.includes("CC"+which)});
}

// Reset Color Correction Values
// 0: lift, 1: gamma, 2: gain, 3: offset, 4: contrast, 5: color & LC
function resetCC(which) {
    if (which == 0) {
        cameras[ci].PUTdata("/colorCorrection/lift", {"red": 0.0, "green": 0.0, "blue": 0.0, "luma": 0.0});
    } else if (which == 1) {
        cameras[ci].PUTdata("/colorCorrection/gamma", {"red": 0.0, "green": 0.0, "blue": 0.0, "luma": 0.0});
    } else if (which == 2) {
        cameras[ci].PUTdata("/colorCorrection/gain", {"red": 1.0, "green": 1.0, "blue": 1.0, "luma": 1.0});
    } else if (which == 3) {
        cameras[ci].PUTdata("/colorCorrection/offset", {"red": 0.0, "green": 0.0, "blue": 0.0, "luma": 0.0});
    } else if (which == 4) {
        cameras[ci].PUTdata("/colorCorrection/contrast", {"pivot": 0.5, "adjust": 1.0});
    } else if (which == 5) {
        cameras[ci].PUTdata("/colorCorrection/color", {"hue": 0.0, "saturation": 1.0});
        cameras[ci].PUTdata("/colorCorrection/lumaContribution", {"lumaContribution": 1.0});
    }

    unsavedChanges = unsavedChanges.filter((e) => {return !e.includes("CC"+which)});
}

// Triggered by the Loop and Single Clip buttons
function loopHandler(callerString) {
    if (!cameras[ci] || !cameras[ci].active) return;
    
    try {
        let playbackState = cameras[ci].propertyData["/transports/0/playback"];
        if (!playbackState) {
            console.warn('Playback state not available');
            return;
        }
        
        if (callerString === "Loop") {
            playbackState.loop = !playbackState.loop;
        } else if (callerString === "Single Clip") {
            playbackState.singleClip = !playbackState.singleClip;
        }

        cameras[ci].PUTdata("/transports/0/playback", playbackState);
        updateUIAll();
    } catch (error) {
        console.error('Error updating playback state:', error);
    }
}

/*  Helper Functions   */
function parseTimecode(timecodeBCD) {
    if (!timecodeBCD) return "00:00:00:00";
    
    try {
        // The first bit of the timecode is 1 if "Drop Frame Timecode" is on
        let noDropFrame = timecodeBCD & 0b01111111111111111111111111111111;
        
        // Convert the BCD number into base ten
        let decimalTCInt = parseInt(noDropFrame.toString(16), 10);
        
        // Convert to string, pad with zeros
        let decimalTCString = decimalTCInt.toString().padStart(8, '0');
        
        // Put colons between every two characters
        let finalTCString = decimalTCString.match(/.{1,2}/g).join(':');
        
        return finalTCString;
    } catch (error) {
        console.error('Error parsing timecode:', error);
        return "00:00:00:00";
    }
}
