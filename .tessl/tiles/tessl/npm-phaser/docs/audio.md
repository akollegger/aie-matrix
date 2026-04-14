# Audio Management

Phaser provides a comprehensive audio system supporting multiple backends (Web Audio API and HTML5 Audio) with features like spatial audio, audio sprites, and dynamic sound effects. The system automatically chooses the best available audio implementation.

## Sound Manager

### Audio System Setup
The sound system is automatically configured based on browser capabilities:

```javascript { .api }
// Game configuration with audio settings
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    audio: {
        disableWebAudio: false,  // Force HTML5 Audio if true
        context: null,           // Custom AudioContext
        noAudio: false          // Disable all audio if true
    },
    scene: AudioScene
};

class AudioScene extends Phaser.Scene {
    create() {
        // Access sound manager
        const sound = this.sound;
        
        // Sound manager properties
        console.log('Audio implementation:', sound.constructor.name);
        console.log('Context locked:', sound.locked);
        console.log('Muted:', sound.mute);
        console.log('Volume:', sound.volume);
        console.log('Sounds count:', sound.sounds.length);
        
        // Global audio settings
        sound.setVolume(0.8);           // Master volume (0-1)
        sound.setMute(false);           // Mute/unmute all sounds
        sound.setRate(1.0);             // Global playback rate
        sound.setDetune(0);             // Global detune in cents
        
        // Audio context unlock (required for Web Audio)
        if (sound.locked) {
            sound.once('unlocked', () => {
                console.log('Audio context unlocked');
            });
        }
    }
}
```

### Loading Audio Files
Load various audio formats and configurations:

```javascript { .api }
class AudioLoadingScene extends Phaser.Scene {
    preload() {
        // Basic audio loading
        this.load.audio('music', 'assets/music.mp3');
        this.load.audio('jump', 'assets/jump.wav');
        
        // Multiple format support (browser will choose best)
        this.load.audio('bgm', [
            'assets/music.ogg',
            'assets/music.mp3',
            'assets/music.m4a'
        ]);
        
        // Audio with configuration
        this.load.audio('explosion', 'assets/explosion.wav', {
            instances: 5  // Pre-create 5 instances for overlapping playback
        });
        
        // Audio sprite (multiple sounds in one file)
        this.load.audioSprite('sfx', 'assets/sfx.json', 'assets/sfx.mp3');
        
        // Base64 encoded audio
        this.load.audio('beep', 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEA...');
        
        // Loading progress
        this.load.on('progress', (percent) => {
            console.log('Audio loading:', Math.round(percent * 100) + '%');
        });
        
        this.load.on('complete', () => {
            console.log('Audio loading complete');
        });
    }
}
```

## Sound Playback

### Basic Sound Control
Create and control sound instances:

```javascript { .api }
class SoundPlaybackScene extends Phaser.Scene {
    create() {
        // Create sound objects
        this.music = this.sound.add('bgm');
        this.jumpSound = this.sound.add('jump');
        this.explosionSound = this.sound.add('explosion');
        
        // Sound configuration
        this.music = this.sound.add('bgm', {
            volume: 0.6,
            loop: true,
            delay: 0.5
        });
        
        // Play sounds
        this.music.play();                    // Basic playback
        this.jumpSound.play({ volume: 0.8 }); // Play with options
        
        // Sound control
        this.music.pause();                   // Pause playback
        this.music.resume();                  // Resume playback
        this.music.stop();                    // Stop playback
        this.music.restart();                 // Restart from beginning
        
        // Sound properties
        this.music.setVolume(0.5);           // Set volume (0-1)
        this.music.setRate(1.2);             // Set playback rate (speed)
        this.music.setDetune(-100);          // Detune in cents
        this.music.setSeek(30);              // Seek to 30 seconds
        this.music.setLoop(true);            // Enable looping
        this.music.setPan(-0.3);             // Stereo pan (-1 to 1)
        
        // Get sound properties
        console.log('Duration:', this.music.duration);
        console.log('Current time:', this.music.seek);
        console.log('Is playing:', this.music.isPlaying);
        console.log('Is paused:', this.music.isPaused);
        console.log('Volume:', this.music.volume);
        console.log('Rate:', this.music.rate);
        
        // Destroy sound when done
        this.music.destroy();
    }
}
```

### Audio Sprites
Use audio sprites for efficient sound management:

```javascript { .api }
class AudioSpriteScene extends Phaser.Scene {
    preload() {
        // Audio sprite JSON format
        const audioSpriteData = {
            "spritemap": {
                "coin": { "start": 0, "end": 0.5, "loop": false },
                "jump": { "start": 1, "end": 1.3, "loop": false },
                "powerup": { "start": 2, "end": 3.5, "loop": false },
                "background": { "start": 4, "end": 34, "loop": true }
            }
        };
        
        this.load.audioSprite('gamesfx', audioSpriteData, 'assets/gamesfx.mp3');
    }
    
    create() {
        // Play audio sprite sounds
        this.sound.playAudioSprite('gamesfx', 'coin');
        this.sound.playAudioSprite('gamesfx', 'jump', { volume: 0.8 });
        
        // Create audio sprite object
        this.gameSfx = this.sound.addAudioSprite('gamesfx');
        
        // Play specific sounds
        this.gameSfx.play('coin');
        this.gameSfx.play('background', { loop: true });
        
        // Stop specific sounds
        this.gameSfx.stop('background');
        
        // Audio sprite events
        this.gameSfx.on('play', (sound) => {
            console.log('Audio sprite playing:', sound.key);
        });
        
        this.gameSfx.on('complete', (sound) => {
            console.log('Audio sprite completed:', sound.key);
        });
    }
    
    collectCoin() {
        this.sound.playAudioSprite('gamesfx', 'coin');
    }
    
    playerJump() {
        this.sound.playAudioSprite('gamesfx', 'jump');
    }
}
```

### Sound Events
Handle sound playback events:

```javascript { .api }
class SoundEventsScene extends Phaser.Scene {
    create() {
        this.music = this.sound.add('bgm');
        this.sfx = this.sound.add('explosion');
        
        // Sound-specific events
        this.music.on('play', () => {
            console.log('Music started playing');
        });
        
        this.music.on('pause', () => {
            console.log('Music paused');
        });
        
        this.music.on('resume', () => {
            console.log('Music resumed');
        });
        
        this.music.on('stop', () => {
            console.log('Music stopped');
        });
        
        this.music.on('complete', () => {
            console.log('Music completed');
            this.onMusicComplete();
        });
        
        this.music.on('looped', () => {
            console.log('Music looped');
        });
        
        this.music.on('volume', (sound, volume) => {
            console.log('Music volume changed to:', volume);
        });
        
        this.music.on('rate', (sound, rate) => {
            console.log('Music rate changed to:', rate);
        });
        
        this.music.on('seek', (sound, time) => {
            console.log('Music seeked to:', time);
        });
        
        // Global sound events
        this.sound.on('mute', (soundManager, mute) => {
            console.log('All sounds muted:', mute);
        });
        
        this.sound.on('volume', (soundManager, volume) => {
            console.log('Global volume changed to:', volume);
        });
        
        this.sound.on('pauseall', () => {
            console.log('All sounds paused');
        });
        
        this.sound.on('resumeall', () => {
            console.log('All sounds resumed');
        });
        
        this.sound.on('stopall', () => {
            console.log('All sounds stopped');
        });
    }
    
    onMusicComplete() {
        // Handle music completion
        this.startNextTrack();
    }
}
```

## Advanced Audio Features

### Spatial Audio
Implement 3D audio positioning:

```javascript { .api }
class SpatialAudioScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        this.enemy = this.add.sprite(600, 200, 'enemy');
        
        // Create positional sound
        this.enemySound = this.sound.add('enemyNoise', { loop: true });
        
        // Update audio position based on distance
        this.updateSpatialAudio();
    }
    
    update() {
        this.updateSpatialAudio();
    }
    
    updateSpatialAudio() {
        if (this.enemySound.isPlaying) {
            // Calculate distance between player and enemy
            const distance = Phaser.Math.Distance.Between(
                this.player.x, this.player.y,
                this.enemy.x, this.enemy.y
            );
            
            // Maximum hearing distance
            const maxDistance = 400;
            
            // Calculate volume based on distance (closer = louder)
            const volume = Math.max(0, 1 - (distance / maxDistance));
            this.enemySound.setVolume(volume);
            
            // Calculate stereo pan based on horizontal position
            const panRange = 200; // Distance for full pan
            const deltaX = this.enemy.x - this.player.x;
            const pan = Phaser.Math.Clamp(deltaX / panRange, -1, 1);
            this.enemySound.setPan(pan);
            
            // Optional: Adjust pitch based on distance (Doppler effect)
            const pitchVariation = 0.2;
            const pitch = 1 + (volume - 0.5) * pitchVariation;
            this.enemySound.setRate(pitch);
        }
    }
    
    enemyAttack() {
        // Play attack sound with spatial positioning
        const attackSound = this.sound.add('attack');
        this.updateSoundPosition(attackSound, this.enemy.x, this.enemy.y);
        attackSound.play();
    }
    
    updateSoundPosition(sound, x, y) {
        const distance = Phaser.Math.Distance.Between(
            this.player.x, this.player.y, x, y
        );
        
        const volume = Math.max(0, 1 - (distance / 300));
        const pan = Phaser.Math.Clamp((x - this.player.x) / 200, -1, 1);
        
        sound.setVolume(volume);
        sound.setPan(pan);
    }
}
```

### Dynamic Music System
Create adaptive music that responds to gameplay:

```javascript { .api }
class DynamicMusicScene extends Phaser.Scene {
    create() {
        // Multiple music layers
        this.musicLayers = {
            base: this.sound.add('music_base', { loop: true }),
            drums: this.sound.add('music_drums', { loop: true }),
            melody: this.sound.add('music_melody', { loop: true }),
            tension: this.sound.add('music_tension', { loop: true })
        };
        
        // Start with base layer
        this.musicLayers.base.play();
        this.currentIntensity = 0;
        
        // Sync all layers
        Object.values(this.musicLayers).forEach(layer => {
            layer.setVolume(0);
        });
        this.musicLayers.base.setVolume(0.8);
        
        // Music state
        this.musicState = 'calm';
        this.targetVolumes = {
            base: 0.8,
            drums: 0,
            melody: 0,
            tension: 0
        };
    }
    
    update() {
        // Smoothly transition layer volumes
        Object.entries(this.musicLayers).forEach(([name, layer]) => {
            const current = layer.volume;
            const target = this.targetVolumes[name];
            const lerp = Phaser.Math.Linear(current, target, 0.02);
            layer.setVolume(lerp);
        });
    }
    
    setMusicState(state) {
        this.musicState = state;
        
        switch (state) {
            case 'calm':
                this.targetVolumes = { base: 0.8, drums: 0, melody: 0.4, tension: 0 };
                break;
            case 'action':
                this.targetVolumes = { base: 0.6, drums: 0.8, melody: 0.6, tension: 0.3 };
                break;
            case 'boss':
                this.targetVolumes = { base: 0.4, drums: 1.0, melody: 0.8, tension: 0.9 };
                break;
            case 'silence':
                this.targetVolumes = { base: 0, drums: 0, melody: 0, tension: 0 };
                break;
        }
    }
    
    onEnemySpawn() {
        this.setMusicState('action');
    }
    
    onBossAppear() {
        this.setMusicState('boss');
    }
    
    onAllEnemiesDefeated() {
        this.setMusicState('calm');
    }
}
```

### Audio Analysis
Analyze audio for reactive visuals:

```javascript { .api }
class AudioAnalysisScene extends Phaser.Scene {
    create() {
        // Web Audio API required for analysis
        if (this.sound.context) {
            this.music = this.sound.add('music');
            
            // Create analyser node
            this.analyser = this.sound.context.createAnalyser();
            this.analyser.fftSize = 256;
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
            
            // Connect audio to analyser
            if (this.music.source) {
                this.music.source.connect(this.analyser);
            }
            
            // Visual elements that react to audio
            this.visualBars = [];
            for (let i = 0; i < 32; i++) {
                const bar = this.add.rectangle(
                    50 + i * 20, 400, 15, 100, 0x00ff00
                );
                this.visualBars.push(bar);
            }
            
            this.music.play({ loop: true });
        }
    }
    
    update() {
        if (this.analyser && this.music.isPlaying) {
            // Get frequency data
            this.analyser.getByteFrequencyData(this.dataArray);
            
            // Update visual bars based on frequency data
            for (let i = 0; i < this.visualBars.length; i++) {
                const bar = this.visualBars[i];
                const frequency = this.dataArray[i * 4] || 0; // Sample every 4th frequency
                const height = (frequency / 255) * 200; // Scale to bar height
                
                bar.height = height;
                bar.y = 400 - height / 2;
                
                // Color based on frequency intensity
                const hue = (frequency / 255) * 120; // Green to red
                bar.fillColor = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1).color;
            }
            
            // Beat detection
            const bassFreq = this.dataArray.slice(0, 4).reduce((a, b) => a + b) / 4;
            if (bassFreq > 200 && !this.beatDetected) {
                this.onBeatDetected();
                this.beatDetected = true;
                this.time.delayedCall(200, () => {
                    this.beatDetected = false;
                });
            }
        }
    }
    
    onBeatDetected() {
        // Flash screen on beat
        this.cameras.main.flash(100, 255, 255, 255, false);
        
        // Pulse visual elements
        this.visualBars.forEach(bar => {
            this.tweens.add({
                targets: bar,
                scaleX: 1.5,
                duration: 100,
                yoyo: true
            });
        });
    }
}
```

### Audio Memory Management
Efficiently manage audio resources:

```javascript { .api }
class AudioMemoryScene extends Phaser.Scene {
    create() {
        // Pre-create sound instances for frequent sounds
        this.soundPool = {
            gunshot: [],
            explosion: [],
            pickup: []
        };
        
        // Pre-populate sound pools
        for (let i = 0; i < 10; i++) {
            this.soundPool.gunshot.push(this.sound.add('gunshot'));
            this.soundPool.explosion.push(this.sound.add('explosion'));
            this.soundPool.pickup.push(this.sound.add('pickup'));
        }
        
        // Track active sounds for cleanup
        this.activeSounds = new Set();
    }
    
    playPooledSound(type, config = {}) {
        const pool = this.soundPool[type];
        if (pool) {
            // Find available sound in pool
            const sound = pool.find(s => !s.isPlaying);
            if (sound) {
                sound.play(config);
                this.activeSounds.add(sound);
                
                // Remove from active sounds when complete
                sound.once('complete', () => {
                    this.activeSounds.delete(sound);
                });
                
                return sound;
            }
        }
        return null;
    }
    
    fireWeapon() {
        this.playPooledSound('gunshot', { volume: 0.6 });
    }
    
    explode() {
        this.playPooledSound('explosion', { volume: 0.8 });
    }
    
    collectItem() {
        this.playPooledSound('pickup', { volume: 0.4 });
    }
    
    cleanup() {
        // Stop all active sounds
        this.activeSounds.forEach(sound => {
            sound.stop();
        });
        this.activeSounds.clear();
        
        // Destroy all sounds in pools
        Object.values(this.soundPool).forEach(pool => {
            pool.forEach(sound => sound.destroy());
        });
        
        // Clear pools
        this.soundPool = {};
    }
    
    shutdown() {
        this.cleanup();
    }
}
```

### Audio Settings
Implement user audio preferences:

```javascript { .api }
class AudioSettingsScene extends Phaser.Scene {
    create() {
        // Load saved audio settings
        this.audioSettings = {
            masterVolume: parseFloat(localStorage.getItem('masterVolume')) || 1.0,
            musicVolume: parseFloat(localStorage.getItem('musicVolume')) || 0.8,
            sfxVolume: parseFloat(localStorage.getItem('sfxVolume')) || 1.0,
            muted: localStorage.getItem('audioMuted') === 'true'
        };
        
        // Apply settings
        this.applyAudioSettings();
        
        // Create audio categories
        this.musicSounds = new Set();
        this.sfxSounds = new Set();
        
        // Background music
        this.bgMusic = this.sound.add('bgm', { loop: true });
        this.musicSounds.add(this.bgMusic);
        this.bgMusic.play();
        
        // UI for audio settings
        this.createAudioUI();
    }
    
    createAudioUI() {
        // Master volume slider
        this.add.text(50, 50, 'Master Volume', { fontSize: '20px' });
        this.masterSlider = this.createVolumeSlider(50, 80, this.audioSettings.masterVolume, (value) => {
            this.audioSettings.masterVolume = value;
            this.saveAudioSettings();
            this.applyAudioSettings();
        });
        
        // Music volume slider
        this.add.text(50, 130, 'Music Volume', { fontSize: '20px' });
        this.musicSlider = this.createVolumeSlider(50, 160, this.audioSettings.musicVolume, (value) => {
            this.audioSettings.musicVolume = value;
            this.saveAudioSettings();
            this.applyAudioSettings();
        });
        
        // SFX volume slider
        this.add.text(50, 210, 'SFX Volume', { fontSize: '20px' });
        this.sfxSlider = this.createVolumeSlider(50, 240, this.audioSettings.sfxVolume, (value) => {
            this.audioSettings.sfxVolume = value;
            this.saveAudioSettings();
            this.applyAudioSettings();
        });
        
        // Mute button
        this.muteButton = this.add.text(50, 300, this.audioSettings.muted ? 'Unmute' : 'Mute', {
            fontSize: '20px',
            backgroundColor: '#444444',
            padding: { x: 10, y: 5 }
        });
        this.muteButton.setInteractive();
        this.muteButton.on('pointerdown', () => {
            this.audioSettings.muted = !this.audioSettings.muted;
            this.muteButton.setText(this.audioSettings.muted ? 'Unmute' : 'Mute');
            this.saveAudioSettings();
            this.applyAudioSettings();
        });
    }
    
    createVolumeSlider(x, y, initialValue, callback) {
        const slider = {
            background: this.add.rectangle(x, y, 200, 20, 0x666666),
            handle: this.add.rectangle(x + (initialValue - 0.5) * 200, y, 20, 30, 0xffffff),
            callback: callback
        };
        
        slider.handle.setInteractive({ draggable: true });
        slider.handle.on('drag', (pointer, dragX) => {
            const minX = x - 100;
            const maxX = x + 100;
            const clampedX = Phaser.Math.Clamp(dragX, minX, maxX);
            slider.handle.x = clampedX;
            
            const value = (clampedX - minX) / 200;
            callback(value);
        });
        
        return slider;
    }
    
    applyAudioSettings() {
        // Apply master volume and mute
        this.sound.setVolume(this.audioSettings.muted ? 0 : this.audioSettings.masterVolume);
        
        // Apply category-specific volumes
        this.musicSounds.forEach(sound => {
            const volume = this.audioSettings.musicVolume * this.audioSettings.masterVolume;
            sound.setVolume(this.audioSettings.muted ? 0 : volume);
        });
        
        this.sfxSounds.forEach(sound => {
            const volume = this.audioSettings.sfxVolume * this.audioSettings.masterVolume;
            sound.setVolume(this.audioSettings.muted ? 0 : volume);
        });
    }
    
    saveAudioSettings() {
        localStorage.setItem('masterVolume', this.audioSettings.masterVolume.toString());
        localStorage.setItem('musicVolume', this.audioSettings.musicVolume.toString());
        localStorage.setItem('sfxVolume', this.audioSettings.sfxVolume.toString());
        localStorage.setItem('audioMuted', this.audioSettings.muted.toString());
    }
    
    playMusic(key, config = {}) {
        const sound = this.sound.add(key, config);
        this.musicSounds.add(sound);
        const volume = this.audioSettings.musicVolume * this.audioSettings.masterVolume;
        sound.setVolume(this.audioSettings.muted ? 0 : volume);
        return sound;
    }
    
    playSFX(key, config = {}) {
        const sound = this.sound.add(key, config);
        this.sfxSounds.add(sound);
        const volume = this.audioSettings.sfxVolume * this.audioSettings.masterVolume;
        sound.setVolume(this.audioSettings.muted ? 0 : volume);
        sound.once('complete', () => {
            this.sfxSounds.delete(sound);
            sound.destroy();
        });
        sound.play();
        return sound;
    }
}
```

This comprehensive audio system provides all the tools needed to create rich, immersive soundscapes with efficient resource management, spatial audio, and user-configurable settings.