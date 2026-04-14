# Utilities

Phaser provides an extensive collection of utility functions organized into functional modules for common programming tasks, device detection, array manipulation, object operations, and mathematical calculations.

## Capabilities

### Array Utilities

Comprehensive array manipulation functions for game object management:

```javascript { .api }
// Adding elements
Phaser.Utils.Array.Add(array, item, limit, callback, context);           // Add item with optional limit
Phaser.Utils.Array.AddAt(array, item, index, limit, callback, context);  // Add at specific index

// Removing elements
Phaser.Utils.Array.Remove(array, item, callback, context);               // Remove first occurrence
Phaser.Utils.Array.RemoveAt(array, index, callback, context);            // Remove at index
Phaser.Utils.Array.RemoveBetween(array, startIndex, endIndex, callback); // Remove range
Phaser.Utils.Array.RemoveRandomElement(array, start, length);            // Remove random element

// Position manipulation
Phaser.Utils.Array.BringToTop(array, item);                             // Move to end of array
Phaser.Utils.Array.SendToBack(array, item);                             // Move to start of array
Phaser.Utils.Array.MoveUp(array, item);                                 // Move one position up
Phaser.Utils.Array.MoveDown(array, item);                               // Move one position down
Phaser.Utils.Array.MoveTo(array, item, index);                          // Move to specific index

// Searching and selection
Phaser.Utils.Array.GetFirst(array, property, value, startIndex, endIndex); // Find first match
Phaser.Utils.Array.GetAll(array, property, value, startIndex, endIndex);   // Find all matches
Phaser.Utils.Array.GetRandom(array, startIndex, length);                   // Get random element
Phaser.Utils.Array.GetRandomElement(array, start, length);                 // Get random element (alias)

// Array operations
Phaser.Utils.Array.Shuffle(array);                                      // Randomize order
Phaser.Utils.Array.Replace(array, oldChild, newChild);                  // Replace element
Phaser.Utils.Array.RotateLeft(array, total);                           // Rotate elements left
Phaser.Utils.Array.RotateRight(array, total);                          // Rotate elements right

// Numerical operations
Phaser.Utils.Array.NumberArray(start, end);                            // Create number sequence
Phaser.Utils.Array.NumberArrayStep(start, end, step);                  // Create with custom step

// Utility checks
Phaser.Utils.Array.FindClosestInSorted(array, value);                  // Binary search closest value
Phaser.Utils.Array.CountAllMatching(array, property, value);           // Count matching elements
Phaser.Utils.Array.Each(array, callback, context, ...args);            // Iterate with callback
Phaser.Utils.Array.EachInRange(array, callback, context, startIndex, endIndex); // Iterate range
```

### Object Utilities

Object manipulation and property access functions:

```javascript { .api }
// Object cloning and merging
const cloned = Phaser.Utils.Objects.Clone(originalObject);              // Deep clone
const merged = Phaser.Utils.Objects.Extend(target, source1, source2);   // Merge objects
const merged2 = Phaser.Utils.Objects.Merge(target, source);             // Merge with deep copy
const merged3 = Phaser.Utils.Objects.MergeRight(target, source);        // Merge from right

// Property access
const value = Phaser.Utils.Objects.GetAdvancedValue(source, 'key', defaultValue);
const value2 = Phaser.Utils.Objects.GetFastValue(source, 'key', defaultValue);
const minMax = Phaser.Utils.Objects.GetMinMaxValue(source, 'key', min, max);

// Value retrieval with fallbacks
const advancedValue = Phaser.Utils.Objects.GetAdvancedValue(config, 'width', 800);
const fastValue = Phaser.Utils.Objects.GetFastValue(settings, 'volume', 1.0);

// Property path access
const nestedValue = Phaser.Utils.Objects.GetValue(config, 'graphics.resolution', 1);

// Object validation
const hasProperty = Phaser.Utils.Objects.HasValue(object, 'property');
const hasAll = Phaser.Utils.Objects.HasAll(object, ['prop1', 'prop2', 'prop3']);
const hasAny = Phaser.Utils.Objects.HasAny(object, ['prop1', 'prop2', 'prop3']);

// Example usage
const gameConfig = {
    width: 800,
    height: 600,
    graphics: {
        resolution: 2,
        antialiasing: true
    },
    audio: {
        volume: 0.8,
        enabled: true
    }
};

const screenWidth = Phaser.Utils.Objects.GetValue(gameConfig, 'width', 1024);
const resolution = Phaser.Utils.Objects.GetValue(gameConfig, 'graphics.resolution', 1);
const soundVolume = Phaser.Utils.Objects.GetValue(gameConfig, 'audio.volume', 1.0);
```

### String Utilities

String manipulation and formatting functions:

```javascript { .api }
// String formatting
const formatted = Phaser.Utils.String.Format(template, ...args);        // sprintf-style formatting
const padded = Phaser.Utils.String.Pad(string, length, pad);            // Pad string to length
const reverse = Phaser.Utils.String.Reverse(string);                    // Reverse string
const uppercased = Phaser.Utils.String.UppercaseFirst(string);          // Capitalize first letter

// Template processing
const processed = Phaser.Utils.String.Template(template, data);         // Template substitution

// UUID generation
const uuid = Phaser.Utils.String.UUID();                               // Generate UUID

// Example usage
const template = "Player {name} scored {score} points in level {level}";
const message = Phaser.Utils.String.Template(template, {
    name: "Alice",
    score: 1500,
    level: 3
});
// Result: "Player Alice scored 1500 points in level 3"

const formattedScore = Phaser.Utils.String.Pad(score.toString(), 6, '0');
// Result: "001500" for score = 1500

const playerId = Phaser.Utils.String.UUID();
// Result: "a1e4f2c8-d3b7-4a5e-9f8c-2d6e7a8b9c0d"
```

### Device Detection

Comprehensive device and browser capability detection:

```javascript { .api }
// Device type detection
const device = scene.sys.game.device;

// Operating System
device.os.android        // Android device
device.os.chromeOS       // Chrome OS
device.os.cordova        // Cordova/PhoneGap
device.os.crosswalk      // Intel Crosswalk
device.os.desktop        // Desktop computer
device.os.ejecta         // Ejecta (iOS JavaScript engine)
device.os.electron       // Electron app
device.os.iOS            // iOS device
device.os.iPad           // iPad specifically
device.os.iPhone         // iPhone specifically
device.os.kindle         // Amazon Kindle
device.os.linux          // Linux OS
device.os.macOS          // macOS
device.os.node           // Node.js environment
device.os.nodeWebkit     // Node-Webkit (NW.js)
device.os.webApp         // Web application
device.os.windows        // Windows OS
device.os.windowsPhone   // Windows Phone

// Browser detection
device.browser.chrome        // Google Chrome
device.browser.edge          // Microsoft Edge
device.browser.firefox       // Mozilla Firefox
device.browser.ie            // Internet Explorer
device.browser.mobileSafari  // Mobile Safari
device.browser.opera         // Opera
device.browser.safari        // Safari
device.browser.silk          // Amazon Silk
device.browser.trident       // Trident engine

// Input capabilities
device.input.keyboard        // Keyboard available
device.input.mouse           // Mouse available
device.input.touch           // Touch input available
device.input.gamepad         // Gamepad support

// Audio capabilities
device.audio.audioData       // Audio Data API
device.audio.dolby           // Dolby audio support
device.audio.mp3             // MP3 format support
device.audio.ogg             // OGG format support
device.audio.opus            // Opus format support
device.audio.wav             // WAV format support
device.audio.webAudio        // Web Audio API
device.audio.m4a             // M4A format support

// Video capabilities
device.video.h264            // H.264 codec support
device.video.hls             // HLS streaming support
device.video.mp4             // MP4 format support
device.video.ogg             // OGG video support
device.video.vp9             // VP9 codec support
device.video.webm            // WebM format support

// Canvas capabilities
device.canvasFeatures.supportInvertedAlpha  // Inverted alpha support
device.canvasFeatures.supportNewBlendModes  // New blend modes

// Feature detection
device.features.canvas         // Canvas support
device.features.canvasText     // Canvas text support
device.features.file           // File API
device.features.fileSystem     // File System API
device.features.getUserMedia   // getUserMedia API
device.features.littleEndian   // Little endian byte order
device.features.localStorage   // Local storage support
device.features.pointerLock    // Pointer lock API
device.features.support32bit   // 32-bit support
device.features.vibration      // Vibration API
device.features.webGL          // WebGL support
device.features.worker         // Web Workers support
```

### Base64 Utilities

Base64 encoding and decoding functions:

```javascript { .api }
// String encoding/decoding
const encoded = Phaser.Utils.Base64.Encode(stringData);                 // Encode string to base64
const decoded = Phaser.Utils.Base64.Decode(base64String);               // Decode base64 to string

// ArrayBuffer operations
const encodedBuffer = Phaser.Utils.Base64.ArrayBufferToBase64(buffer);  // Encode ArrayBuffer
const decodedBuffer = Phaser.Utils.Base64.Base64ToArrayBuffer(base64);  // Decode to ArrayBuffer

// Example usage
const gameData = JSON.stringify({
    level: 5,
    score: 1500,
    inventory: ['sword', 'potion', 'key']
});

const encodedSave = Phaser.Utils.Base64.Encode(gameData);
localStorage.setItem('gameState', encodedSave);

// Later, load the data
const savedData = localStorage.getItem('gameState');
const decodedData = Phaser.Utils.Base64.Decode(savedData);
const gameState = JSON.parse(decodedData);
```

### NOOP and NULL Utilities

Utility functions for default values and empty operations:

```javascript { .api }
// No-operation function
Phaser.Utils.NOOP();          // Function that does nothing, returns undefined

// NULL function
Phaser.Utils.NULL();          // Function that does nothing, returns false

// Example usage in callbacks
const config = {
    onComplete: callback || Phaser.Utils.NOOP,  // Use NOOP if no callback provided
    onError: errorHandler || Phaser.Utils.NULL  // Use NULL if no error handler
};

// Default event handlers
gameObject.on('complete', onComplete || Phaser.Utils.NOOP);
gameObject.on('error', onError || Phaser.Utils.NULL);
```

### Advanced Utility Patterns

```javascript { .api }
// Configuration management with utilities
class GameSettings {
    constructor(config = {}) {
        this.width = Phaser.Utils.Objects.GetValue(config, 'width', 800);
        this.height = Phaser.Utils.Objects.GetValue(config, 'height', 600);
        this.volume = Phaser.Utils.Objects.GetValue(config, 'audio.volume', 1.0);
        this.quality = Phaser.Utils.Objects.GetValue(config, 'graphics.quality', 'medium');
        
        // Merge default settings with user config
        this.settings = Phaser.Utils.Objects.Merge({
            graphics: { antialiasing: true, resolution: 1 },
            audio: { enabled: true, volume: 1.0 },
            controls: { keyboard: true, mouse: true }
        }, config);
    }
    
    save() {
        const data = Phaser.Utils.Base64.Encode(JSON.stringify(this.settings));
        localStorage.setItem('gameSettings', data);
    }
    
    load() {
        const saved = localStorage.getItem('gameSettings');
        if (saved) {
            const decoded = Phaser.Utils.Base64.Decode(saved);
            const loadedSettings = JSON.parse(decoded);
            this.settings = Phaser.Utils.Objects.Merge(this.settings, loadedSettings);
        }
    }
}

// Array-based game object management
class ObjectPool {
    constructor() {
        this.pool = [];
        this.active = [];
    }
    
    get() {
        let obj = Phaser.Utils.Array.RemoveRandomElement(this.pool);
        if (!obj) {
            obj = this.create();
        }
        Phaser.Utils.Array.Add(this.active, obj);
        return obj;
    }
    
    release(obj) {
        Phaser.Utils.Array.Remove(this.active, obj);
        Phaser.Utils.Array.Add(this.pool, obj);
        obj.reset();
    }
    
    create() {
        // Override in subclass
        return {};
    }
    
    shuffleActive() {
        Phaser.Utils.Array.Shuffle(this.active);
    }
    
    getRandomActive() {
        return Phaser.Utils.Array.GetRandom(this.active);
    }
}

// Device-specific optimizations
function optimizeForDevice(scene) {
    const device = scene.sys.game.device;
    
    if (device.os.mobile) {
        // Mobile optimizations
        scene.physics.world.fps = 30;  // Lower physics rate
        scene.sound.volume = device.os.iOS ? 0.7 : 0.8;  // iOS volume adjustment
    }
    
    if (device.browser.ie) {
        // IE-specific fallbacks
        scene.renderer.type = Phaser.CANVAS;  // Force canvas on IE
    }
    
    if (!device.features.webGL) {
        // WebGL fallback
        console.log('WebGL not supported, using Canvas renderer');
        scene.renderer.type = Phaser.CANVAS;
    }
    
    if (device.input.touch && !device.input.mouse) {
        // Touch-only interface adjustments
        scene.input.addPointer(2);  // Support multi-touch
    }
}
```

## Types

```javascript { .api }
// Array Utilities
namespace Phaser.Utils.Array {
    function Add<T>(array: T[], item: T | T[], limit?: number, callback?: function, context?: any): T[];
    function Remove<T>(array: T[], item: T, callback?: function, context?: any): T;
    function GetRandom<T>(array: T[], startIndex?: number, length?: number): T;
    function Shuffle<T>(array: T[]): T[];
    // ... additional array function signatures
}

// Object Utilities
namespace Phaser.Utils.Objects {
    function Clone(obj: object): object;
    function Extend(target: object, ...sources: object[]): object;
    function GetValue(source: object, key: string, defaultValue?: any): any;
    function HasValue(source: object, key: string): boolean;
    // ... additional object function signatures
}

// String Utilities
namespace Phaser.Utils.String {
    function Format(string: string, ...args: any[]): string;
    function Pad(string: string, length: number, pad?: string): string;
    function Template(template: string, data: object): string;
    function UUID(): string;
    // ... additional string function signatures
}

// Base64 Utilities
namespace Phaser.Utils.Base64 {
    function Encode(data: string): string;
    function Decode(data: string): string;
    function ArrayBufferToBase64(buffer: ArrayBuffer): string;
    function Base64ToArrayBuffer(base64: string): ArrayBuffer;
}

// Device Detection Types
interface Device {
    os: {
        android: boolean;
        iOS: boolean;
        desktop: boolean;
        // ... additional OS flags
    };
    browser: {
        chrome: boolean;
        firefox: boolean;
        safari: boolean;
        // ... additional browser flags
    };
    features: {
        webGL: boolean;
        canvas: boolean;
        localStorage: boolean;
        // ... additional feature flags
    };
}
```