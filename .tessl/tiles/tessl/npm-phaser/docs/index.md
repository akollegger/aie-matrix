# Phaser 3.90.0

## Overview

Phaser is a fast, free, and fun HTML5 game framework for desktop and mobile web browsers. It provides a comprehensive suite of tools for 2D game development with WebGL and Canvas rendering support, physics engines, input handling, audio management, and much more.

Phaser follows a modular architecture centered around Scenes, GameObjects, and Systems that work together to create interactive games and applications.

## Package Information

- **Package Name**: phaser
- **Package Type**: npm
- **Language**: JavaScript/TypeScript
- **Installation**: `npm install phaser`

## Core Imports

### CommonJS
```javascript { .api }
const Phaser = require('phaser');
```

### ES Modules
```javascript { .api }
import Phaser from 'phaser';
```

### CDN
```html { .api }
<script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
```

## Basic Usage

### Game Initialization
```javascript { .api }
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

function preload() {
    this.load.image('logo', 'assets/logo.png');
}

function create() {
    this.add.image(400, 300, 'logo');
}

function update() {
    // Game loop logic
}
```

### Scene Class Approach
```javascript { .api }
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }
    
    preload() {
        this.load.image('background', 'assets/bg.jpg');
        this.load.spritesheet('player', 'assets/player.png', {
            frameWidth: 32,
            frameHeight: 48
        });
    }
    
    create() {
        this.add.image(0, 0, 'background').setOrigin(0);
        this.player = this.add.sprite(100, 450, 'player');
    }
    
    update() {
        // Update logic
    }
}

const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    scene: GameScene
});
```

## Architecture

Phaser uses a component-based architecture with the following key concepts:

### Game Instance
The root `Phaser.Game` object manages the entire game lifecycle, including scenes, rendering, input, and system updates.

### Scenes
Scenes are self-contained game states (menu, gameplay, game over). Each scene has its own:
- Display list (rendered objects)
- Update list (objects that receive update calls)
- Input handling
- Physics world
- Camera system

### GameObjects
All visual and interactive elements inherit from `Phaser.GameObjects.GameObject`. Common objects include Sprites, Images, Text, Graphics, and Containers.

### Systems
Scenes contain various systems for managing different aspects:
- `scene.add` - GameObject factory
- `scene.input` - Input handling
- `scene.physics` - Physics simulation
- `scene.cameras` - Camera management
- `scene.tweens` - Animation tweening

## Capabilities

### [Game Objects](game-objects.md)
Comprehensive collection of display objects for creating game content.

**Key APIs:**
```javascript { .api }
// Sprites with texture animation support
scene.add.sprite(x, y, 'texture', frame);

// Static images 
scene.add.image(x, y, 'texture');

// Text rendering with styling
scene.add.text(x, y, 'Hello World', { fontSize: '32px', fill: '#000' });

// Vector graphics drawing
const graphics = scene.add.graphics();
graphics.fillRect(0, 0, 100, 100);

// Containers for grouping objects
const container = scene.add.container(x, y);
container.add([sprite1, sprite2, text]);
```

**Coverage:** Sprites, Images, Text, Graphics, Containers, Shapes, Particle Systems, Video, DOM Elements, WebGL Shaders, 3D Objects

### [Scene Management](scenes.md)
Scene lifecycle management and transitions between game states.

**Key APIs:**
```javascript { .api }
// Scene transitions
scene.scene.start('NextScene', data);
scene.scene.pause();
scene.scene.resume();

// Multiple scenes
scene.scene.launch('UIScene');
scene.scene.run('BackgroundScene');
```

**Coverage:** Scene lifecycle, transitions, parallel scenes, data passing, scene plugins

### [Input Handling](input.md)
Multi-platform input support for keyboard, mouse, touch, and gamepad.

**Key APIs:**
```javascript { .api }
// Keyboard input
const cursors = scene.input.keyboard.createCursorKeys();
if (cursors.left.isDown) { /* move left */ }

// Mouse/touch input
scene.input.on('pointerdown', (pointer) => {
    console.log('Clicked at:', pointer.x, pointer.y);
});

// Interactive objects
sprite.setInteractive();
sprite.on('pointerdown', () => { /* handle click */ });
```

**Coverage:** Keyboard, mouse, touch, gamepad, interactive objects, drag and drop

### [Animation Systems](animation.md)
Frame-based animations and tweening for smooth visual effects.

**Key APIs:**
```javascript { .api }
// Create frame animation
scene.anims.create({
    key: 'walk',
    frames: scene.anims.generateFrameNumbers('player', { start: 0, end: 3 }),
    frameRate: 10,
    repeat: -1
});

// Tween animations
scene.tweens.add({
    targets: sprite,
    x: 400,
    duration: 2000,
    ease: 'Power2'
});
```

**Coverage:** Sprite animations, tweens, timelines, easing functions, animation events

### [Physics Systems](physics.md)
Physics simulation with Arcade Physics (fast) and Matter.js (realistic).

**Key APIs:**
```javascript { .api }
// Enable Arcade Physics
scene.physics.add.sprite(x, y, 'texture');

// Collision detection
scene.physics.add.collider(player, platforms);

// Matter.js physics bodies
scene.matter.add.rectangle(x, y, width, height);
```

**Coverage:** Arcade Physics, Matter.js integration, collision detection, physics groups, constraints

### [Camera System](cameras.md)
Flexible camera system with effects, following, and multi-camera support.

**Key APIs:**
```javascript { .api }
// Camera controls
scene.cameras.main.startFollow(player);
scene.cameras.main.setZoom(2);

// Camera effects
scene.cameras.main.shake(1000, 0.05);
scene.cameras.main.fade(1000);

// Multiple cameras
const camera2 = scene.cameras.add(100, 100, 200, 200);
```

**Coverage:** Camera movement, following, effects, bounds, multiple cameras

### [Audio Management](audio.md)
Comprehensive audio system with Web Audio API and HTML5 Audio support.

**Key APIs:**
```javascript { .api }
// Load and play sounds
scene.load.audio('music', 'assets/music.mp3');
const music = scene.sound.add('music');
music.play();

// Audio sprites
scene.load.audioSprite('sfx', 'assets/sounds.json', 'assets/sounds.mp3');
scene.sound.playAudioSprite('sfx', 'jump');
```

**Coverage:** Audio loading, playback, audio sprites, 3D audio, sound effects

### [Asset Loading](loading.md)
Flexible asset loading system supporting multiple file types and loading strategies.

**Key APIs:**
```javascript { .api }
// Load various asset types
scene.load.image('logo', 'assets/logo.png');
scene.load.spritesheet('player', 'assets/player.png', { frameWidth: 32, frameHeight: 48 });
scene.load.atlas('atlas', 'assets/atlas.png', 'assets/atlas.json');
scene.load.audio('music', 'assets/music.mp3');

// Loading events
scene.load.on('progress', (percent) => {
    console.log('Loading:', Math.round(percent * 100) + '%');
});
```

**Coverage:** Image loading, spritesheets, atlases, audio, JSON, XML, binary data, asset packs

### [Math & Geometry](math-geometry.md)
Comprehensive mathematical functions and geometric operations.

**Key APIs:**
```javascript { .api }
// Vector math
const vector = new Phaser.Math.Vector2(x, y);
vector.normalize().scale(100);

// Geometric shapes
const circle = new Phaser.Geom.Circle(x, y, radius);
const rect = new Phaser.Geom.Rectangle(x, y, width, height);

// Intersection testing
Phaser.Geom.Intersects.CircleToRectangle(circle, rect);
```

**Coverage:** Vector math, matrices, geometric shapes, intersection testing, interpolation, easing

### [Rendering & Display](rendering.md)
WebGL and Canvas rendering with textures, effects, and display management.

**Key APIs:**
```javascript { .api }
// Texture management
scene.textures.addBase64('key', base64Data);
scene.textures.create('canvas', canvasElement);

// Blend modes and effects
sprite.setBlendMode(Phaser.BlendModes.ADD);
sprite.setTint(0xff0000);

// Render textures
const renderTexture = scene.add.renderTexture(x, y, width, height);
renderTexture.draw(sprite);
```

**Coverage:** WebGL/Canvas rendering, textures, blend modes, shaders, render textures, display utilities

### [Tweens & Timeline Animation](tweens.md)
Property tweening and complex animation sequences for smooth visual transitions.

**Key APIs:**
```javascript { .api }
// Property tweening
scene.tweens.add({
    targets: sprite,
    x: 400,
    alpha: 0.5,
    duration: 2000,
    ease: 'Power2'
});

// Timeline sequences
const timeline = scene.tweens.timeline();
timeline.add({ targets: sprite1, x: 200, duration: 1000 });
timeline.add({ targets: sprite2, y: 300, duration: 500 });
```

**Coverage:** Individual tweens, tween chains, timelines, easing functions, tween control, property interpolation

[Tweens](./tweens.md)

### [Data Management](data-management.md)
Key-value data storage with event-driven updates for GameObjects and Scenes.

**Key APIs:**
```javascript { .api }
// Store data with events
scene.data.set('score', 1500);
sprite.data.set('health', 100);

// Listen for data changes
scene.data.on('setdata-score', (parent, key, value) => {
    updateScoreDisplay(value);
});

// Manipulate numeric data
scene.data.inc('score', 100);
sprite.data.dec('health', 25);
```

**Coverage:** Scene data management, GameObject data storage, data events, serialization, cross-scene data sharing

[Data Management](./data-management.md)

### [Events System](events.md)
Comprehensive event-driven communication system throughout the framework.

**Key APIs:**
```javascript { .api }
// Event handling
scene.events.on('eventName', callback);
gameObject.on('pointerdown', handleClick);

// Event emission
scene.events.emit('customEvent', data);

// Scene lifecycle events
scene.events.on('preupdate', updateLogic);
scene.events.on('shutdown', cleanup);
```

**Coverage:** EventEmitter pattern, scene events, GameObject events, input events, physics events, custom events

[Events](./events.md)

### [Actions System](actions.md)
Batch operations for efficiently manipulating arrays of GameObjects.

**Key APIs:**
```javascript { .api }
// Bulk positioning
Phaser.Actions.SetXY(gameObjects, 100, 200);
Phaser.Actions.PlaceOnCircle(gameObjects, circle);
Phaser.Actions.GridAlign(gameObjects, { width: 5, height: 4 });

// Visual properties
Phaser.Actions.SetAlpha(gameObjects, 0.5);
Phaser.Actions.SetScale(gameObjects, 2);
Phaser.Actions.RandomRectangle(gameObjects, bounds);
```

**Coverage:** Positioning actions, geometric placement, random placement, visual properties, utility operations

[Actions](./actions.md)

### [Utilities](utilities.md)
Essential utility functions for arrays, objects, strings, device detection, and data encoding.

**Key APIs:**
```javascript { .api }
// Array manipulation
Phaser.Utils.Array.Shuffle(array);
Phaser.Utils.Array.GetRandom(array);

// Object operations
Phaser.Utils.Objects.Clone(object);
Phaser.Utils.Objects.GetValue(config, 'key', defaultValue);

// Device detection
const device = scene.sys.game.device;
if (device.os.mobile) { /* mobile optimizations */ }

// String utilities
const uuid = Phaser.Utils.String.UUID();
const encoded = Phaser.Utils.Base64.Encode(data);
```

**Coverage:** Array utilities, object manipulation, string formatting, device/browser detection, Base64 encoding, NOOP functions

[Utilities](./utilities.md)

## Constants and Configuration

### Renderer Types
```javascript { .api }
Phaser.AUTO      // Auto-detect (WebGL with Canvas fallback)
Phaser.WEBGL     // Force WebGL
Phaser.CANVAS    // Force Canvas
Phaser.HEADLESS  // Headless mode for testing
```

### Common Constants
```javascript { .api }
Phaser.FOREVER   // -1 (infinite loops)
Phaser.VERSION   // '3.90.0'
```

### Direction Constants
```javascript { .api }
Phaser.LEFT      // 7
Phaser.RIGHT     // 8  
Phaser.UP        // 5
Phaser.DOWN      // 6
```

## Game Configuration

### Basic Configuration
```javascript { .api }
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#2c3e50',
    scene: [MenuScene, GameScene, GameOverScene],
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300 },
            debug: false
        }
    },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};
```

### Advanced Configuration
```javascript { .api }
const config = {
    type: Phaser.WEBGL,
    width: 1024,
    height: 768,
    canvas: document.getElementById('game-canvas'),
    canvasStyle: 'width: 100%; height: 100%;',
    scene: {
        preload: preloadAssets,
        create: createGame,
        update: updateGame
    },
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0.8 },
            debug: true
        }
    },
    input: {
        keyboard: true,
        mouse: true,
        touch: true,
        gamepad: true
    },
    loader: {
        baseURL: 'https://cdn.example.com/assets/',
        crossOrigin: 'anonymous'
    },
    plugins: {
        global: [
            { key: 'MyPlugin', plugin: MyPluginClass, start: true }
        ],
        scene: [
            { key: 'ScenePlugin', plugin: ScenePluginClass, mapping: 'myPlugin' }
        ]
    }
};
```

## Namespace Organization

Phaser organizes its functionality into logical namespaces:

- `Phaser.Actions` - Bulk operations on GameObject arrays
- `Phaser.Animations` - Animation system  
- `Phaser.Cameras` - Camera management
- `Phaser.Core` - Core game systems
- `Phaser.Display` - Display utilities
- `Phaser.GameObjects` - All GameObject types
- `Phaser.Geom` - Geometric shapes and operations
- `Phaser.Input` - Input handling systems
- `Phaser.Loader` - Asset loading
- `Phaser.Math` - Mathematical functions
- `Phaser.Physics` - Physics engines
- `Phaser.Scale` - Game scaling
- `Phaser.Scene` - Scene base class
- `Phaser.Sound` - Audio system
- `Phaser.Textures` - Texture management
- `Phaser.Tweens` - Animation tweening
- `Phaser.Utils` - Utility functions

This modular organization allows for efficient development and easy navigation of Phaser's extensive API surface covering over 1000 methods across 200+ classes.