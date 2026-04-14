# Scene Management

Scenes are self-contained game states that manage their own display lists, update loops, input handling, and systems. They form the structural backbone of Phaser games, representing different screens like menus, gameplay, pause screens, and game over states.

## Scene Basics

### Scene Class
The base `Phaser.Scene` class provides the foundation for all game scenes.

```javascript { .api }
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }
    
    init(data) {
        // Initialize scene with passed data
        this.score = data.score || 0;
        this.level = data.level || 1;
    }
    
    preload() {
        // Load assets for this scene
        this.load.image('player', 'assets/player.png');
        this.load.audio('bgm', 'assets/music.mp3');
    }
    
    create(data) {
        // Create game objects and set up scene
        this.player = this.add.sprite(400, 300, 'player');
        this.music = this.sound.add('bgm');
        this.music.play({ loop: true });
    }
    
    update(time, delta) {
        // Game logic updated every frame
        if (this.input.keyboard.addKey('SPACE').isDown) {
            this.player.y -= 200 * (delta / 1000);
        }
    }
}
```

### Scene Configuration
Scenes can be configured with various options:

```javascript { .api }
class MenuScene extends Phaser.Scene {
    constructor() {
        super({
            key: 'MenuScene',
            active: true,        // Start active
            visible: true,       // Start visible
            pack: {              // Preload pack
                files: [
                    { type: 'image', key: 'logo', url: 'assets/logo.png' }
                ]
            },
            cameras: {           // Camera configuration
                name: 'menuCam',
                x: 0,
                y: 0,
                width: 800,
                height: 600
            },
            map: {              // Tilemap auto-load
                key: 'menu_map',
                tileWidth: 32,
                tileHeight: 32
            },
            physics: {          // Physics configuration
                default: 'arcade',
                arcade: {
                    gravity: { y: 300 }
                }
            }
        });
    }
}
```

## Scene Lifecycle

### Lifecycle Methods
Scenes have a defined lifecycle with specific callback methods:

```javascript { .api }
class LifecycleScene extends Phaser.Scene {
    init(data) {
        // Called first when scene starts
        // Use for variable initialization
        console.log('Scene initializing with data:', data);
        this.playerName = data.playerName || 'Player';
    }
    
    preload() {
        // Called after init, used for asset loading
        this.load.image('background', 'assets/bg.jpg');
        this.load.spritesheet('character', 'assets/char.png', {
            frameWidth: 32,
            frameHeight: 48
        });
        
        // Show loading progress
        this.load.on('progress', (percent) => {
            console.log('Loading:', Math.round(percent * 100) + '%');
        });
    }
    
    create(data) {
        // Called after preload completes
        // Create game objects and set up scene
        this.add.image(400, 300, 'background');
        this.character = this.add.sprite(100, 400, 'character');
        
        // Set up input
        this.cursors = this.input.keyboard.createCursorKeys();
        
        // Scene is now ready for interaction
        console.log('Scene ready for', this.playerName);
    }
    
    update(time, delta) {
        // Called every frame while scene is active
        if (this.cursors.left.isDown) {
            this.character.x -= 150 * (delta / 1000);
        }
        if (this.cursors.right.isDown) {
            this.character.x += 150 * (delta / 1000);
        }
    }
}
```

### Scene Events
Scenes emit events during their lifecycle:

```javascript { .api }
class EventScene extends Phaser.Scene {
    create() {
        // Listen to scene events
        this.events.on('create', () => {
            console.log('Scene created');
        });
        
        this.events.on('wake', (sys, data) => {
            console.log('Scene woken up with data:', data);
        });
        
        this.events.on('sleep', () => {
            console.log('Scene going to sleep');
        });
        
        this.events.on('pause', () => {
            console.log('Scene paused');
        });
        
        this.events.on('resume', () => {
            console.log('Scene resumed');
        });
        
        this.events.on('shutdown', () => {
            console.log('Scene shutting down');
        });
        
        this.events.on('destroy', () => {
            console.log('Scene destroyed');
        });
    }
}
```

## Scene Management

### Scene Plugin
The Scene Plugin (`this.scene`) provides methods for managing scenes:

```javascript { .api }
class GameScene extends Phaser.Scene {
    create() {
        // Start another scene
        this.scene.start('NextScene', { score: this.score });
        
        // Launch scene in parallel
        this.scene.launch('UIScene');
        this.scene.launch('BackgroundScene');
        
        // Switch to scene (stops current, starts new)
        this.scene.switch('MenuScene');
        
        // Pause/Resume scenes
        this.scene.pause('GameScene');
        this.scene.resume('GameScene');
        
        // Sleep/Wake scenes (like pause but stops updates)
        this.scene.sleep('GameScene');
        this.scene.wake('GameScene', { newData: 'value' });
        
        // Stop scene
        this.scene.stop('GameScene');
        
        // Restart current scene
        this.scene.restart({ resetScore: true });
        
        // Set scene visibility
        this.scene.setVisible(false, 'BackgroundScene');
        
        // Move scenes up/down in render order
        this.scene.moveUp('UIScene');
        this.scene.moveDown('BackgroundScene');
        this.scene.bringToTop('UIScene');
        this.scene.sendToBack('BackgroundScene');
    }
}
```

### Scene Manager
Access the global scene manager through `this.scene.manager`:

```javascript { .api }
class ManagerScene extends Phaser.Scene {
    create() {
        const manager = this.scene.manager;
        
        // Get scene references
        const gameScene = manager.getScene('GameScene');
        const activeScenes = manager.getScenes(true);  // Only active
        const allScenes = manager.getScenes(false);    // All scenes
        
        // Scene queries
        const isActive = manager.isActive('GameScene');
        const isVisible = manager.isVisible('UIScene');
        const isSleeping = manager.isSleeping('BackgroundScene');
        
        // Scene operations
        manager.start('GameScene', { level: 2 });
        manager.pause('GameScene');
        manager.resume('GameScene');
        manager.sleep('GameScene');
        manager.wake('GameScene');
        manager.stop('GameScene');
        manager.switch('MenuScene');
        
        // Batch operations
        manager.pauseAll();
        manager.resumeAll();
        
        // Scene events on manager
        manager.on('start', (event, scene) => {
            console.log('Scene started:', scene.sys.settings.key);
        });
        
        manager.on('ready', (event, scene) => {
            console.log('Scene ready:', scene.sys.settings.key);
        });
    }
}
```

## Multiple Scene Architecture

### Parallel Scenes
Run multiple scenes simultaneously for layered functionality:

```javascript { .api }
// Main game scene
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }
    
    create() {
        // Set up main game
        this.add.image(400, 300, 'background');
        this.player = this.add.sprite(100, 400, 'player');
        
        // Launch UI overlay
        this.scene.launch('UIScene');
        
        // Launch background effects
        this.scene.launch('ParticleScene');
        
        // Communication between scenes
        this.events.on('updateScore', (score) => {
            this.scene.get('UIScene').events.emit('scoreChanged', score);
        });
    }
}

// UI overlay scene
class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene' });
    }
    
    create() {
        // Create UI elements that stay on top
        this.scoreText = this.add.text(16, 16, 'Score: 0', {
            fontSize: '32px',
            fill: '#000'
        });
        
        // Listen for score updates
        this.events.on('scoreChanged', (score) => {
            this.scoreText.setText('Score: ' + score);
        });
        
        // UI doesn't scroll with camera
        this.cameras.main.setScroll(0, 0);
    }
}

// Background effects scene
class ParticleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ParticleScene' });
    }
    
    create() {
        // Background particle effects
        this.particles = this.add.particles(400, 300, 'particle', {
            speed: 50,
            lifespan: 2000,
            quantity: 2,
            scale: { start: 0.5, end: 0 }
        });
        
        // Render behind main scene
        this.scene.moveDown();
    }
}
```

### Scene Communication
Scenes can communicate through events and data:

```javascript { .api }
// Game scene sends events
class GameScene extends Phaser.Scene {
    playerDied() {
        // Send event to UI
        this.events.emit('playerDied');
        
        // Send event to other scenes via scene manager
        this.scene.manager.scenes.forEach(scene => {
            if (scene.sys.settings.key !== 'GameScene') {
                scene.events.emit('gameOver', { score: this.score });
            }
        });
        
        // Switch to game over with data
        this.scene.start('GameOverScene', {
            score: this.score,
            level: this.level,
            time: this.gameTime
        });
    }
}

// UI scene listens for events
class UIScene extends Phaser.Scene {
    create() {
        // Listen to game scene events
        const gameScene = this.scene.get('GameScene');
        gameScene.events.on('playerDied', () => {
            this.showGameOverUI();
        });
        
        // Global scene events
        this.events.on('gameOver', (data) => {
            this.displayFinalScore(data.score);
        });
    }
}
```

## Scene Transitions

### Transition Effects
Create smooth transitions between scenes:

```javascript { .api }
class TransitionScene extends Phaser.Scene {
    fadeToScene(sceneKey, duration = 1000) {
        // Fade out current scene
        this.cameras.main.fadeOut(duration, 0, 0, 0);
        
        // When fade completes, switch scenes
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start(sceneKey);
        });
    }
    
    slideToScene(sceneKey, direction = 'left') {
        const camera = this.cameras.main;
        const targetX = direction === 'left' ? -800 : 800;
        
        // Slide camera off screen
        this.tweens.add({
            targets: camera,
            scrollX: targetX,
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                this.scene.start(sceneKey);
            }
        });
    }
    
    create() {
        // Transition buttons
        this.add.text(100, 100, 'Fade Transition', { fontSize: '24px' })
            .setInteractive()
            .on('pointerdown', () => {
                this.fadeToScene('NextScene');
            });
            
        this.add.text(100, 150, 'Slide Transition', { fontSize: '24px' })
            .setInteractive()
            .on('pointerdown', () => {
                this.slideToScene('NextScene', 'left');
            });
    }
}
```

### Loading Scenes
Handle asset loading with dedicated loading scenes:

```javascript { .api }
class LoadingScene extends Phaser.Scene {
    constructor() {
        super({ key: 'LoadingScene' });
    }
    
    preload() {
        // Create loading UI
        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222);
        progressBox.fillRect(240, 270, 320, 50);
        
        const loadingText = this.add.text(400, 240, 'Loading...', {
            fontSize: '20px',
            fill: '#ffffff'
        }).setOrigin(0.5);
        
        const percentText = this.add.text(400, 300, '0%', {
            fontSize: '18px',
            fill: '#ffffff'
        }).setOrigin(0.5);
        
        // Update progress
        this.load.on('progress', (percent) => {
            progressBar.clear();
            progressBar.fillStyle(0xffffff);
            progressBar.fillRect(250, 280, 300 * percent, 30);
            percentText.setText(Math.round(percent * 100) + '%');
        });
        
        this.load.on('complete', () => {
            loadingText.setText('Complete!');
            this.time.delayedCall(500, () => {
                this.scene.start('GameScene');
            });
        });
        
        // Load game assets
        this.loadGameAssets();
    }
    
    loadGameAssets() {
        this.load.image('background', 'assets/bg.jpg');
        this.load.spritesheet('player', 'assets/player.png', {
            frameWidth: 32,
            frameHeight: 48
        });
        this.load.audio('music', 'assets/music.mp3');
        // ... more assets
    }
}
```

## Scene Data Management

### Scene Data
Each scene has its own data manager for storing scene-specific data:

```javascript { .api }
class DataScene extends Phaser.Scene {
    create() {
        // Set scene data
        this.data.set('score', 100);
        this.data.set('level', 1);
        this.data.set('player', {
            name: 'Hero',
            health: 100,
            mana: 50
        });
        
        // Get scene data
        const score = this.data.get('score');
        const player = this.data.get('player');
        
        // Increment values
        this.data.inc('score', 10);
        this.data.inc('level');
        
        // Toggle boolean
        this.data.toggle('paused');
        
        // Listen for data changes
        this.data.on('setdata', (parent, key, value) => {
            console.log('Data set:', key, value);
        });
        
        this.data.on('changedata-score', (parent, value, prevValue) => {
            console.log('Score changed from', prevValue, 'to', value);
        });
        
        // Remove data
        this.data.remove('temporaryValue');
        
        // Reset all data
        this.data.reset();
    }
}
```

### Global Registry
Access game-wide data through the global registry:

```javascript { .api }
class RegistryScene extends Phaser.Scene {
    create() {
        // Global data accessible from any scene
        this.registry.set('playerName', 'Hero');
        this.registry.set('highScore', 5000);
        this.registry.set('unlockedLevels', [1, 2, 3]);
        
        // Get global data
        const playerName = this.registry.get('playerName');
        const highScore = this.registry.get('highScore');
        
        // Listen for global data changes
        this.registry.on('setdata', (parent, key, value) => {
            if (key === 'highScore') {
                this.updateHighScoreDisplay(value);
            }
        });
        
        // Any scene can update global data
        this.registry.inc('highScore', 100);
    }
}
```

## Scene Systems

### Scene Systems Access
Each scene has access to various game systems:

```javascript { .api }
class SystemsScene extends Phaser.Scene {
    create() {
        // Core systems
        const game = this.game;                    // Game instance
        const scene = this.scene;                  // Scene plugin
        const anims = this.anims;                  // Animation manager
        const cache = this.cache;                  // Cache manager
        const registry = this.registry;            // Global registry
        const sound = this.sound;                  // Sound manager
        const textures = this.textures;            // Texture manager
        
        // Scene-specific systems
        const cameras = this.cameras;              // Camera manager
        const add = this.add;                      // GameObject factory
        const make = this.make;                    // GameObject creator
        const physics = this.physics;              // Physics world
        const input = this.input;                  // Input manager
        const load = this.load;                    // Loader plugin
        const time = this.time;                    // Clock
        const tweens = this.tweens;                // Tween manager
        const lights = this.lights;                // Lights system
        const data = this.data;                    // Scene data manager
        
        // Display management
        const children = this.children;            // Display list
        const displayList = this.displayList;     // Same as children
        const updateList = this.updateList;       // Update list
        
        // Events
        const events = this.events;                // Scene events
    }
}
```

### Custom Scene Systems
Extend scenes with custom functionality:

```javascript { .api }
class CustomScene extends Phaser.Scene {
    constructor(config) {
        super(config);
        
        // Custom properties
        this.gameState = 'playing';
        this.enemies = [];
        this.powerUps = [];
    }
    
    init() {
        // Custom initialization
        this.setupCustomSystems();
    }
    
    setupCustomSystems() {
        // Custom enemy manager
        this.enemyManager = {
            spawn: (x, y, type) => {
                const enemy = this.add.sprite(x, y, type);
                this.enemies.push(enemy);
                return enemy;
            },
            
            update: () => {
                this.enemies.forEach(enemy => {
                    // Update enemy logic
                });
            },
            
            removeAll: () => {
                this.enemies.forEach(enemy => enemy.destroy());
                this.enemies = [];
            }
        };
        
        // Custom event system
        this.gameEvents = new Phaser.Events.EventEmitter();
        this.gameEvents.on('enemyDefeated', this.onEnemyDefeated, this);
        this.gameEvents.on('powerUpCollected', this.onPowerUpCollected, this);
    }
    
    update(time, delta) {
        if (this.gameState === 'playing') {
            this.enemyManager.update();
        }
    }
    
    onEnemyDefeated(enemy) {
        // Handle enemy defeat
        this.data.inc('score', 100);
        this.gameEvents.emit('scoreUpdated', this.data.get('score'));
    }
    
    onPowerUpCollected(powerUp) {
        // Handle power-up collection
        this.data.set('powerUpActive', true);
        this.time.delayedCall(5000, () => {
            this.data.set('powerUpActive', false);
        });
    }
}
```

This comprehensive scene management system provides the structure and flexibility needed to create complex, multi-state games with smooth transitions and robust data management.