# Asset Loading System

Phaser's loader system provides comprehensive asset loading capabilities supporting multiple file types, loading strategies, and progress monitoring. The system handles caching, parallel downloads, and various asset formats automatically.

## Loader Plugin

### Basic Loading
Each scene has its own loader accessible via `this.load`:

```javascript { .api }
class LoadingScene extends Phaser.Scene {
    preload() {
        // Basic asset loading
        this.load.image('logo', 'assets/logo.png');
        this.load.audio('music', 'assets/music.mp3');
        this.load.json('gameData', 'assets/data.json');
        
        // Load with key and URL
        this.load.image('background', 'assets/images/bg.jpg');
        
        // Load with configuration
        this.load.image('sprite', 'assets/sprite.png', {
            frameConfig: {
                frameWidth: 32,
                frameHeight: 32
            }
        });
        
        // Start loading (automatic in preload)
        this.load.start();
    }
    
    create() {
        // Assets are now available
        this.add.image(400, 300, 'logo');
        this.sound.add('music').play();
    }
}
```

### Loader Configuration
Configure global loader settings:

```javascript { .api }
class ConfiguredLoadingScene extends Phaser.Scene {
    init() {
        // Configure loader settings
        this.load.setBaseURL('https://cdn.example.com/');
        this.load.setPath('assets/');
        this.load.setPrefix('game_');
        
        // Cross-origin settings
        this.load.setCORS('anonymous');
        
        // Parallel loading
        this.load.maxParallelDownloads = 4;  // Default: 32
        
        // Response type for XHR
        this.load.setXHRSettings({
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'Custom-Header': 'value'
            }
        });
    }
    
    preload() {
        // URLs will be: https://cdn.example.com/assets/game_logo.png
        this.load.image('logo', 'logo.png');
        
        // Override settings for specific file
        this.load.image('special', 'special.png', {
            xhrSettings: {
                responseType: 'blob',
                timeout: 5000
            }
        });
    }
}
```

## File Types

### Images
Load various image formats and configurations:

```javascript { .api }
class ImageLoadingScene extends Phaser.Scene {
    preload() {
        // Basic image
        this.load.image('logo', 'assets/logo.png');
        
        // Spritesheet
        this.load.spritesheet('player', 'assets/player.png', {
            frameWidth: 32,
            frameHeight: 48,
            startFrame: 0,
            endFrame: 7
        });
        
        // Texture atlas (JSON)
        this.load.atlas('characters', 'assets/characters.png', 'assets/characters.json');
        
        // Texture atlas (XML)
        this.load.atlasXML('ui', 'assets/ui.png', 'assets/ui.xml');
        
        // Multi-atlas (multiple texture sheets)
        this.load.multiatlas('game', 'assets/game.json');
        
        // Unity atlas
        this.load.unityAtlas('unity', 'assets/unity.png', 'assets/unity.txt');
        
        // SVG images
        this.load.svg('vector', 'assets/vector.svg', { width: 300, height: 300 });
        
        // Base64 images
        this.load.image('base64', 'data:image/png;base64,iVBORw0KGgoAAAANS...');
        
        // HTML as texture
        this.load.htmlTexture('htmlText', 'assets/text.html', 512, 256);
    }
}
```

### Audio Files
Load audio with various formats and configurations:

```javascript { .api }
class AudioLoadingScene extends Phaser.Scene {
    preload() {
        // Basic audio
        this.load.audio('bgm', 'assets/music.mp3');
        
        // Multiple formats (browser chooses best)
        this.load.audio('sfx', [
            'assets/sound.ogg',
            'assets/sound.mp3',
            'assets/sound.wav'
        ]);
        
        // Audio with instances for overlapping playback
        this.load.audio('explosion', 'assets/explosion.wav', {
            instances: 5
        });
        
        // Audio sprite
        this.load.audioSprite('gamesfx', 'assets/gamesfx.json', [
            'assets/gamesfx.ogg',
            'assets/gamesfx.mp3'
        ]);
        
        // Streaming audio (not cached)
        this.load.audio('stream', 'assets/longtrack.mp3', {
            stream: true
        });
    }
}
```

### Data Files
Load various data formats:

```javascript { .api }
class DataLoadingScene extends Phaser.Scene {
    preload() {
        // JSON data
        this.load.json('gameConfig', 'assets/config.json');
        
        // XML data
        this.load.xml('levelData', 'assets/level.xml');
        
        // Plain text
        this.load.text('story', 'assets/story.txt');
        
        // CSV data
        this.load.text('scores', 'assets/scores.csv');
        
        // Binary data
        this.load.binary('saveFile', 'assets/save.dat');
        
        // CSS files
        this.load.css('styles', 'assets/game.css');
        
        // HTML files
        this.load.html('template', 'assets/template.html');
        
        // JavaScript files
        this.load.script('external', 'assets/external.js');
    }
    
    create() {
        // Access loaded data
        const config = this.cache.json.get('gameConfig');
        const levelData = this.cache.xml.get('levelData');
        const story = this.cache.text.get('story');
        
        console.log('Game config:', config);
        console.log('Level data:', levelData);
        console.log('Story text:', story);
    }
}
```

### Fonts and Textures
Load bitmap fonts and special textures:

```javascript { .api }
class FontLoadingScene extends Phaser.Scene {
    preload() {
        // Bitmap font
        this.load.bitmapFont('pixel', 'assets/fonts/pixel.png', 'assets/fonts/pixel.xml');
        
        // Bitmap font (JSON format)
        this.load.bitmapFont('arcade', 'assets/fonts/arcade.png', 'assets/fonts/arcade.json');
        
        // Google Fonts (Web Font Loader required)
        this.load.script('webfont', 'https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js');
        
        // Texture from canvas
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 64, 64);
        
        this.textures.addCanvas('redSquare', canvas);
    }
    
    create() {
        // Use bitmap font
        this.add.bitmapText(100, 100, 'pixel', 'Hello World');
        
        // Use generated texture
        this.add.image(200, 200, 'redSquare');
        
        // Load Google Fonts dynamically
        if (window.WebFont) {
            WebFont.load({
                google: {
                    families: ['Orbitron']
                },
                active: () => {
                    this.add.text(300, 300, 'Google Font', {
                        fontFamily: 'Orbitron',
                        fontSize: '24px'
                    });
                }
            });
        }
    }
}
```

### 3D and Advanced Assets
Load 3D models and shaders:

```javascript { .api }
class Advanced3DLoadingScene extends Phaser.Scene {
    preload() {
        // OBJ 3D model
        this.load.obj('model', 'assets/model.obj', 'assets/model.mtl');
        
        // GLSL shaders
        this.load.glsl('vertexShader', 'assets/vertex.glsl');
        this.load.glsl('fragmentShader', 'assets/fragment.glsl');
        
        // Video files
        this.load.video('intro', 'assets/intro.mp4');
        this.load.video('background', [
            'assets/bg.webm',
            'assets/bg.mp4'
        ]);
        
        // Compressed textures (WebGL)
        this.load.texture('compressed', {
            ETC1: 'assets/texture.etc1',
            PVRTC: 'assets/texture.pvr',
            S3TC: 'assets/texture.dxt'
        });
    }
    
    create() {
        // Use loaded assets
        if (this.renderer.type === Phaser.WEBGL) {
            // Create shader
            const shader = this.add.shader('fragmentShader', 100, 100, 200, 200);
            
            // Play video
            const video = this.add.video(400, 300, 'intro');
            video.play();
        }
    }
}
```

## Loading Progress and Events

### Progress Monitoring
Track loading progress with detailed feedback:

```javascript { .api }
class ProgressLoadingScene extends Phaser.Scene {
    preload() {
        // Create progress UI
        this.createProgressBar();
        
        // Loading events
        this.load.on('start', () => {
            console.log('Loading started');
            this.progressText.setText('Loading...');
        });
        
        this.load.on('progress', (percent) => {
            console.log('Loading progress:', percent);
            this.updateProgressBar(percent);
            this.progressText.setText(`Loading: ${Math.round(percent * 100)}%`);
        });
        
        this.load.on('fileprogress', (file, percent) => {
            console.log(`File ${file.key}: ${Math.round(percent * 100)}%`);
            this.fileText.setText(`Loading: ${file.key}`);
        });
        
        this.load.on('complete', () => {
            console.log('Loading complete');
            this.progressText.setText('Complete!');
            this.time.delayedCall(1000, () => {
                this.scene.start('GameScene');
            });
        });
        
        // File-specific events
        this.load.on('filecomplete', (key, type, data) => {
            console.log(`Loaded ${type}: ${key}`);
        });
        
        this.load.on('filecomplete-image-logo', (key, type, data) => {
            console.log('Logo loaded!');
        });
        
        // Error handling
        this.load.on('loaderror', (file) => {
            console.error('Failed to load:', file.key);
            this.errorText.setText(`Error loading: ${file.key}`);
        });
        
        // Load assets
        this.loadGameAssets();
    }
    
    createProgressBar() {
        // Progress bar background
        this.progressBox = this.add.graphics();
        this.progressBox.fillStyle(0x222222);
        this.progressBox.fillRect(240, 270, 320, 50);
        
        // Progress bar fill
        this.progressBar = this.add.graphics();
        
        // Progress text
        this.progressText = this.add.text(400, 240, 'Loading...', {
            fontSize: '20px',
            fill: '#ffffff'
        }).setOrigin(0.5);
        
        // Current file text
        this.fileText = this.add.text(400, 330, '', {
            fontSize: '16px',
            fill: '#ffffff'
        }).setOrigin(0.5);
        
        // Error text
        this.errorText = this.add.text(400, 360, '', {
            fontSize: '16px',
            fill: '#ff0000'
        }).setOrigin(0.5);
    }
    
    updateProgressBar(percent) {
        this.progressBar.clear();
        this.progressBar.fillStyle(0xffffff);
        this.progressBar.fillRect(250, 280, 300 * percent, 30);
    }
    
    loadGameAssets() {
        // Load multiple assets
        this.load.image('background', 'assets/bg.jpg');
        this.load.spritesheet('player', 'assets/player.png', {
            frameWidth: 32, frameHeight: 48
        });
        this.load.atlas('ui', 'assets/ui.png', 'assets/ui.json');
        this.load.audio('music', ['assets/music.ogg', 'assets/music.mp3']);
        this.load.audio('sfx', 'assets/sfx.wav');
        this.load.json('levels', 'assets/levels.json');
        // Add more assets...
    }
}
```

### Asset Packs
Organize assets into reusable packs:

```javascript { .api }
class AssetPackScene extends Phaser.Scene {
    preload() {
        // Define asset pack
        const assetPack = {
            "section1": {
                "files": [
                    {
                        "type": "image",
                        "key": "logo",
                        "url": "assets/logo.png"
                    },
                    {
                        "type": "image",
                        "key": "background",
                        "url": "assets/bg.jpg"
                    },
                    {
                        "type": "spritesheet",
                        "key": "player",
                        "url": "assets/player.png",
                        "frameConfig": {
                            "frameWidth": 32,
                            "frameHeight": 48
                        }
                    },
                    {
                        "type": "audio",
                        "key": "music",
                        "urls": ["assets/music.ogg", "assets/music.mp3"],
                        "config": {
                            "loop": true,
                            "volume": 0.8
                        }
                    }
                ]
            },
            "section2": {
                "files": [
                    {
                        "type": "atlas",
                        "key": "sprites",
                        "textureURL": "assets/sprites.png",
                        "atlasURL": "assets/sprites.json"
                    },
                    {
                        "type": "bitmapFont",
                        "key": "font",
                        "textureURL": "assets/font.png",
                        "fontDataURL": "assets/font.xml"
                    }
                ]
            }
        };
        
        // Load from pack object
        this.load.pack("gameAssets", assetPack);
        
        // Load from external pack file
        this.load.pack("uiAssets", "assets/ui-pack.json");
        
        // Load specific pack section
        this.load.pack("levelAssets", "assets/levels-pack.json", "level1");
    }
}
```

## Advanced Loading Techniques

### Dynamic Loading
Load assets at runtime based on game state:

```javascript { .api }
class DynamicLoadingScene extends Phaser.Scene {
    create() {
        this.currentLevel = 1;
        this.loadingQueue = [];
        this.isLoading = false;
    }
    
    loadLevel(levelNumber) {
        if (this.isLoading) {
            this.loadingQueue.push(levelNumber);
            return;
        }
        
        this.isLoading = true;
        
        // Create temporary loader
        const loader = new Phaser.Loader.LoaderPlugin(this);
        
        // Configure for this level
        loader.setPath(`assets/levels/${levelNumber}/`);
        
        // Load level-specific assets
        loader.image('background', 'bg.jpg');
        loader.json('data', 'data.json');
        loader.atlas('enemies', 'enemies.png', 'enemies.json');
        
        // Progress tracking
        loader.on('progress', (percent) => {
            this.showLoadingProgress(percent);
        });
        
        loader.once('complete', () => {
            this.isLoading = false;
            this.hideLoadingProgress();
            this.startLevel(levelNumber);
            
            // Process queue
            if (this.loadingQueue.length > 0) {
                const nextLevel = this.loadingQueue.shift();
                this.loadLevel(nextLevel);
            }
        });
        
        // Start loading
        loader.start();
    }
    
    preloadNextLevel() {
        // Preload next level assets in background
        const nextLevel = this.currentLevel + 1;
        
        // Check if already loaded
        if (this.textures.exists(`level${nextLevel}_bg`)) {
            return;
        }
        
        // Background loading without blocking current gameplay
        const backgroundLoader = new Phaser.Loader.LoaderPlugin(this);
        backgroundLoader.setPath(`assets/levels/${nextLevel}/`);
        backgroundLoader.image(`level${nextLevel}_bg`, 'bg.jpg');
        backgroundLoader.json(`level${nextLevel}_data`, 'data.json');
        
        backgroundLoader.once('complete', () => {
            console.log(`Level ${nextLevel} preloaded`);
        });
        
        backgroundLoader.start();
    }
    
    showLoadingProgress(percent) {
        if (!this.loadingOverlay) {
            this.loadingOverlay = this.add.graphics();
            this.loadingText = this.add.text(400, 300, '', {
                fontSize: '24px',
                fill: '#ffffff'
            }).setOrigin(0.5);
        }
        
        this.loadingOverlay.clear();
        this.loadingOverlay.fillStyle(0x000000, 0.8);
        this.loadingOverlay.fillRect(0, 0, 800, 600);
        
        this.loadingText.setText(`Loading: ${Math.round(percent * 100)}%`);
    }
    
    hideLoadingProgress() {
        if (this.loadingOverlay) {
            this.loadingOverlay.destroy();
            this.loadingText.destroy();
            this.loadingOverlay = null;
            this.loadingText = null;
        }
    }
}
```

### Asset Streaming
Stream large assets progressively:

```javascript { .api }
class StreamingScene extends Phaser.Scene {
    preload() {
        // Stream large audio files
        this.load.audio('backgroundMusic', 'assets/long-track.mp3', {
            stream: true
        });
        
        // Progressive texture loading
        this.loadTexturesProgressively([
            'texture1', 'texture2', 'texture3', 'texture4'
        ]);
    }
    
    loadTexturesProgressively(textureKeys) {
        let currentIndex = 0;
        const batchSize = 2; // Load 2 textures at a time
        
        const loadBatch = () => {
            if (currentIndex >= textureKeys.length) {
                return;
            }
            
            const batch = textureKeys.slice(currentIndex, currentIndex + batchSize);
            const batchLoader = new Phaser.Loader.LoaderPlugin(this);
            
            batch.forEach(key => {
                batchLoader.image(key, `assets/${key}.png`);
            });
            
            batchLoader.once('complete', () => {
                currentIndex += batchSize;
                this.time.delayedCall(100, loadBatch); // Small delay between batches
            });
            
            batchLoader.start();
        };
        
        loadBatch();
    }
}
```

### Memory Management
Efficiently manage loaded assets:

```javascript { .api }
class MemoryManagementScene extends Phaser.Scene {
    create() {
        this.loadedAssets = new Set();
    }
    
    loadAssets(assetList, callback) {
        const loader = new Phaser.Loader.LoaderPlugin(this);
        
        assetList.forEach(asset => {
            if (!this.loadedAssets.has(asset.key)) {
                loader[asset.type](asset.key, asset.url, asset.config);
                this.loadedAssets.add(asset.key);
            }
        });
        
        if (loader.list.size > 0) {
            loader.once('complete', callback);
            loader.start();
        } else {
            callback(); // All assets already loaded
        }
    }
    
    unloadUnusedAssets() {
        // Remove textures not used in current scene
        const textureKeys = this.textures.getTextureKeys();
        
        textureKeys.forEach(key => {
            if (!this.isAssetInUse(key)) {
                this.textures.remove(key);
                this.loadedAssets.delete(key);
                console.log('Unloaded texture:', key);
            }
        });
        
        // Remove sounds not playing
        this.sound.sounds.forEach(sound => {
            if (!sound.isPlaying && sound.key !== 'backgroundMusic') {
                sound.destroy();
            }
        });
        
        // Clear cache entries
        this.cache.json.entries.clear();
        this.cache.xml.entries.clear();
    }
    
    isAssetInUse(key) {
        // Check if any game object is using this asset
        return this.children.exists((child) => {
            return child.texture && child.texture.key === key;
        });
    }
    
    getMemoryUsage() {
        const textureMemory = this.textures.getTextureKeys().length;
        const audioMemory = this.sound.sounds.length;
        const cacheMemory = Object.keys(this.cache.json.entries).length +
                           Object.keys(this.cache.xml.entries).length;
        
        return {
            textures: textureMemory,
            audio: audioMemory,
            cache: cacheMemory,
            total: textureMemory + audioMemory + cacheMemory
        };
    }
    
    shutdown() {
        // Clean up when scene shuts down
        this.unloadUnusedAssets();
    }
}
```

This comprehensive loading system provides all the tools needed to efficiently manage assets throughout a game's lifecycle, from initial loading screens to dynamic runtime asset management.