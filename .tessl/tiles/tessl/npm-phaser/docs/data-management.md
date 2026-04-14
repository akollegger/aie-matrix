# Data Management

Phaser provides robust data storage and management capabilities through the Data Manager system. This allows for organized key-value data storage with event-driven updates across GameObjects and Scenes.

## Capabilities

### Scene Data Manager

Every Scene has a built-in Data Manager for storing scene-level data with automatic event handling.

```javascript { .api }
// Store scene data
scene.data.set('score', 1000);
scene.data.set('level', 5);
scene.data.set('playerName', 'Alice');

// Store multiple values at once
scene.data.set({
    lives: 3,
    powerUps: ['speed', 'jump'],
    settings: {
        sound: true,
        music: false
    }
});

// Retrieve data
const score = scene.data.get('score');
const allData = scene.data.getAll();

// Check if data exists
if (scene.data.has('score')) {
    console.log('Score exists:', scene.data.get('score'));
}

// Remove data
scene.data.remove('temporaryValue');

// Increment/decrement numeric values
scene.data.inc('score', 100);    // Add 100 to score
scene.data.dec('lives', 1);      // Subtract 1 from lives

// Toggle boolean values
scene.data.toggle('paused');
```

### GameObject Data Manager

Each GameObject can store its own data independently from the scene.

```javascript { .api }
// Store data on a sprite
sprite.data.set('health', 100);
sprite.data.set('type', 'enemy');
sprite.data.set('abilities', ['fire', 'ice']);

// Batch set data
sprite.data.set({
    damage: 25,
    speed: 150,
    experience: 500
});

// Access data
const health = sprite.data.get('health');
const allSpriteData = sprite.data.getAll();

// Data manipulation
sprite.data.inc('experience', 50);
sprite.data.dec('health', 10);

// Conditional operations
if (sprite.data.get('health') <= 0) {
    sprite.destroy();
}

// Store complex objects
sprite.data.set('inventory', {
    weapons: ['sword', 'bow'],
    armor: 'leather',
    consumables: {
        potions: 3,
        scrolls: 1
    }
});
```

### Data Events

Data Managers emit events when data changes, enabling reactive programming patterns.

```javascript { .api }
// Listen for specific data changes
scene.data.on('setdata-score', function(parent, key, value) {
    console.log('Score changed to:', value);
    updateScoreDisplay(value);
});

// Listen for any data change
scene.data.on('setdata', function(parent, key, value) {
    console.log(`${key} changed to:`, value);
});

// Listen for data removal
scene.data.on('removedata', function(parent, key, value) {
    console.log(`Removed ${key}:`, value);
});

// GameObject data events
sprite.data.on('setdata-health', function(parent, key, value) {
    if (value <= 0) {
        parent.destroy();
    } else if (value <= 20) {
        parent.setTint(0xff0000); // Red tint when low health
    }
});

// Multiple data listeners
sprite.data.on('setdata', function(parent, key, value) {
    // React to any data change on this sprite
    if (key === 'position') {
        updateMinimap(parent, value);
    }
});
```

### Advanced Data Operations

```javascript { .api }
// Data validation and transformation
scene.data.set('playerLevel', 5);
scene.data.on('setdata-playerLevel', function(parent, key, value) {
    if (value > 100) {
        // Cap level at 100
        scene.data.set('playerLevel', 100, false); // false = don't emit event
    }
});

// Computed properties
scene.data.set('baseAttack', 10);
scene.data.set('weaponBonus', 5);
scene.data.on('setdata-baseAttack', updateTotalAttack);
scene.data.on('setdata-weaponBonus', updateTotalAttack);

function updateTotalAttack() {
    const total = scene.data.get('baseAttack') + scene.data.get('weaponBonus');
    scene.data.set('totalAttack', total, false); // Don't trigger events
}

// Conditional data storage
const saveState = {
    score: scene.data.get('score'),
    level: scene.data.get('level'),
    timestamp: Date.now()
};

// Only save if score improved
if (saveState.score > scene.data.get('highScore', 0)) {
    scene.data.set('highScore', saveState.score);
    localStorage.setItem('gameState', JSON.stringify(saveState));
}
```

### Data Serialization

```javascript { .api }
// Export scene data for saving
const gameState = {
    sceneData: scene.data.getAll(),
    playerData: player.data.getAll(),
    enemyData: enemies.children.entries.map(enemy => ({
        id: enemy.name,
        data: enemy.data.getAll()
    }))
};

// Save to localStorage
localStorage.setItem('saveGame', JSON.stringify(gameState));

// Load and restore data
const savedState = JSON.parse(localStorage.getItem('saveGame'));
if (savedState) {
    // Restore scene data
    scene.data.set(savedState.sceneData);
    
    // Restore player data
    player.data.set(savedState.playerData);
    
    // Restore enemy data
    savedState.enemyData.forEach(enemyState => {
        const enemy = scene.children.getByName(enemyState.id);
        if (enemy) {
            enemy.data.set(enemyState.data);
        }
    });
}
```

### Data Manager Integration

```javascript { .api }
// Cross-scene data sharing
const gameData = new Phaser.Data.DataManager(scene);

// Share data between scenes
scene.scene.start('NextScene', { 
    sharedData: gameData,
    playerLevel: scene.data.get('level')
});

// In the next scene
class NextScene extends Phaser.Scene {
    init(data) {
        this.sharedData = data.sharedData;
        this.playerLevel = data.playerLevel;
    }
    
    create() {
        // Access shared data
        this.sharedData.on('setdata-globalScore', (parent, key, value) => {
            this.updateGlobalScoreDisplay(value);
        });
    }
}

// Global game state management
class GameState {
    constructor() {
        this.data = new Phaser.Data.DataManager();
        this.data.set({
            totalScore: 0,
            unlockedLevels: [1],
            achievements: [],
            settings: {
                soundVolume: 1.0,
                musicVolume: 0.8,
                difficulty: 'normal'
            }
        });
    }
    
    unlockLevel(levelNumber) {
        const unlockedLevels = this.data.get('unlockedLevels');
        if (!unlockedLevels.includes(levelNumber)) {
            unlockedLevels.push(levelNumber);
            this.data.set('unlockedLevels', unlockedLevels);
        }
    }
    
    addAchievement(achievementId) {
        const achievements = this.data.get('achievements');
        if (!achievements.includes(achievementId)) {
            achievements.push(achievementId);
            this.data.set('achievements', achievements);
        }
    }
}
```

## Types

```javascript { .api }
class DataManager {
    constructor(parent?: any, eventEmitter?: Phaser.Events.EventEmitter);
    
    // Data storage
    set(key: string | object, data?: any, emit?: boolean): this;
    get(key: string, defaultValue?: any): any;
    getAll(): object;
    has(key: string): boolean;
    remove(key: string): this;
    
    // Numeric operations
    inc(key: string, amount?: number): this;
    dec(key: string, amount?: number): this;
    
    // Boolean operations
    toggle(key: string): this;
    
    // Utility
    count(): number;
    dump(): string;
    destroy(): void;
    
    // Events
    on(event: string, fn: function, context?: any): this;
    once(event: string, fn: function, context?: any): this;
    off(event: string, fn?: function, context?: any): this;
    emit(event: string, ...args: any[]): boolean;
}

// Data Manager Events
interface DataManagerEvents {
    'setdata': (parent: any, key: string, value: any) => void;
    'removedata': (parent: any, key: string, value: any) => void;
    'destroy': () => void;
    // Dynamic events
    'setdata-[key]': (parent: any, key: string, value: any) => void;
    'removedata-[key]': (parent: any, key: string, value: any) => void;
}
```