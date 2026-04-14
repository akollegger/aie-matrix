# Actions System

Phaser's Actions system provides over 65 utility functions for performing batch operations on arrays of GameObjects. These functions enable efficient manipulation of multiple objects simultaneously, perfect for managing groups, collections, and bulk transformations.

## Capabilities

### Positioning Actions

Bulk positioning and alignment operations for multiple GameObjects:

```javascript { .api }
// Set absolute positions
Phaser.Actions.SetX(gameObjects, 100);              // Set all X positions to 100
Phaser.Actions.SetY(gameObjects, 200);              // Set all Y positions to 200
Phaser.Actions.SetXY(gameObjects, 100, 200);        // Set both X and Y positions

// Incremental positioning
Phaser.Actions.IncX(gameObjects, 50);               // Add 50 to each X position
Phaser.Actions.IncY(gameObjects, -30);              // Subtract 30 from each Y position
Phaser.Actions.IncXY(gameObjects, 10, 20);          // Add to both X and Y

// Shift positions (with optional distance and direction)
Phaser.Actions.ShiftPosition(gameObjects, 100, 45); // Shift 100 pixels at 45 degrees

// Alignment operations
Phaser.Actions.AlignTo(gameObjects, Phaser.Display.Align.CENTER);
Phaser.Actions.AlignTo(gameObjects, Phaser.Display.Align.TOP_LEFT);
Phaser.Actions.AlignTo(gameObjects, Phaser.Display.Align.BOTTOM_RIGHT);

// Grid alignment
Phaser.Actions.GridAlign(gameObjects, {
    width: 5,                    // 5 columns
    height: 4,                   // 4 rows
    cellWidth: 64,               // Cell width
    cellHeight: 64,              // Cell height
    x: 100,                      // Starting X
    y: 100                       // Starting Y
});
```

### Geometric Placement

Place GameObjects along geometric shapes and patterns:

```javascript { .api }
// Circle placement
Phaser.Actions.PlaceOnCircle(gameObjects, new Phaser.Geom.Circle(400, 300, 150));

// Ellipse placement
Phaser.Actions.PlaceOnEllipse(gameObjects, new Phaser.Geom.Ellipse(400, 300, 200, 100));

// Line placement
Phaser.Actions.PlaceOnLine(gameObjects, new Phaser.Geom.Line(100, 100, 500, 400));

// Rectangle placement (around perimeter)
Phaser.Actions.PlaceOnRectangle(gameObjects, new Phaser.Geom.Rectangle(200, 150, 300, 200));

// Triangle placement
Phaser.Actions.PlaceOnTriangle(gameObjects, new Phaser.Geom.Triangle(400, 100, 200, 400, 600, 400));

// Advanced circle placement with start angle and step
Phaser.Actions.PlaceOnCircle(gameObjects, circle, 0, Math.PI / 4); // Start at 0, step by 45 degrees
```

### Random Placement

Randomly position GameObjects within geometric bounds:

```javascript { .api }
// Random positions within shapes
Phaser.Actions.RandomCircle(gameObjects, new Phaser.Geom.Circle(400, 300, 100));
Phaser.Actions.RandomEllipse(gameObjects, new Phaser.Geom.Ellipse(400, 300, 200, 100));
Phaser.Actions.RandomLine(gameObjects, new Phaser.Geom.Line(100, 100, 500, 100));
Phaser.Actions.RandomRectangle(gameObjects, new Phaser.Geom.Rectangle(100, 100, 400, 300));
Phaser.Actions.RandomTriangle(gameObjects, new Phaser.Geom.Triangle(400, 100, 200, 400, 600, 400));

// Shuffle array order
Phaser.Actions.Shuffle(gameObjects);

// Example: Randomly scatter enemies
const enemies = scene.add.group();
for (let i = 0; i < 10; i++) {
    enemies.create(0, 0, 'enemy');
}
Phaser.Actions.RandomRectangle(enemies.children.entries, new Phaser.Geom.Rectangle(0, 0, 800, 600));
```

### Visual Property Actions

Bulk manipulation of visual properties:

```javascript { .api }
// Alpha/transparency
Phaser.Actions.SetAlpha(gameObjects, 0.5);          // Set all to 50% opacity
Phaser.Actions.SetAlpha(gameObjects, 0.2, 0.1);     // Start at 0.2, increment by 0.1
Phaser.Actions.IncAlpha(gameObjects, -0.1);         // Decrease alpha by 0.1

// Scaling
Phaser.Actions.SetScale(gameObjects, 2);            // Set all to 2x scale
Phaser.Actions.SetScale(gameObjects, 0.5, 1.5);     // Start at 0.5, end at 1.5
Phaser.Actions.SetScaleX(gameObjects, 2);           // Set X scale only
Phaser.Actions.SetScaleY(gameObjects, 0.5);         // Set Y scale only
Phaser.Actions.ScaleX(gameObjects, 1.1);            // Multiply X scale by 1.1
Phaser.Actions.ScaleY(gameObjects, 0.9);            // Multiply Y scale by 0.9
Phaser.Actions.ScaleXY(gameObjects, 1.1, 0.9);      // Scale both axes

// Rotation
Phaser.Actions.SetRotation(gameObjects, Math.PI / 4); // Set all to 45 degrees
Phaser.Actions.SetRotation(gameObjects, 0, Math.PI / 8); // Start at 0, increment by 22.5 degrees
Phaser.Actions.Rotate(gameObjects, 0.1);             // Add 0.1 radians to rotation

// Origin point
Phaser.Actions.SetOrigin(gameObjects, 0.5, 0);       // Set origin to top-center
Phaser.Actions.SetOrigin(gameObjects, 0, 1);         // Set origin to bottom-left

// Visibility
Phaser.Actions.SetVisible(gameObjects, false);       // Hide all objects
Phaser.Actions.ToggleVisible(gameObjects);           // Toggle visibility state

// Depth (z-order)
Phaser.Actions.SetDepth(gameObjects, 100);           // Set all to depth 100
Phaser.Actions.SetDepth(gameObjects, 50, 10);        // Start at 50, increment by 10

// Tinting
Phaser.Actions.SetTint(gameObjects, 0xff0000);       // Tint all red
Phaser.Actions.SetTint(gameObjects, 0xffffff);       // Remove tint (white)

// Blend modes
Phaser.Actions.SetBlendMode(gameObjects, Phaser.BlendModes.ADD);
Phaser.Actions.SetBlendMode(gameObjects, Phaser.BlendModes.MULTIPLY);
```

### Selection and Filtering Actions

Get specific objects from arrays:

```javascript { .api }
// Get first/last objects
const first = Phaser.Actions.GetFirst(gameObjects, { active: true });
const last = Phaser.Actions.GetLast(gameObjects, { visible: true });

// Get objects by properties
const healthyEnemies = Phaser.Actions.GetFirst(enemies, { health: 100 }, 5); // Get first 5 with health = 100

// Custom filtering with callback
function isAlive(gameObject) {
    return gameObject.getData('health') > 0;
}
const aliveEnemies = gameObjects.filter(isAlive);
```

### Property Manipulation

Set or increment custom properties on multiple objects:

```javascript { .api }
// Set property values
Phaser.Actions.PropertyValueSet(gameObjects, 'health', 100);           // Set health to 100
Phaser.Actions.PropertyValueSet(gameObjects, 'speed', 150, 50);        // Start at 150, increment by 50

// Increment property values
Phaser.Actions.PropertyValueInc(gameObjects, 'experience', 25);        // Add 25 experience
Phaser.Actions.PropertyValueInc(gameObjects, 'level', 1, 0);           // Add 1 level, starting at 0

// Example: Level up all players
const players = scene.children.getByName('player');
Phaser.Actions.PropertyValueInc(players, 'level', 1);
Phaser.Actions.PropertyValueSet(players, 'experience', 0); // Reset experience
```

### Utility Actions

Additional utility functions for array manipulation:

```javascript { .api }
// Call function on each object
Phaser.Actions.Call(gameObjects, function(gameObject) {
    gameObject.setInteractive();
    gameObject.on('pointerdown', handleClick);
});

// Call method with parameters
Phaser.Actions.Call(gameObjects, 'setTint', 0xff0000);  // Call setTint(0xff0000) on each

// Wrap objects within boundaries
const bounds = new Phaser.Geom.Rectangle(0, 0, 800, 600);
Phaser.Actions.WrapInRectangle(gameObjects, bounds);

// Example: Update all enemies
Phaser.Actions.Call(enemies.children.entries, function(enemy) {
    // Custom update logic for each enemy
    enemy.update();
    
    // Check if enemy is dead
    if (enemy.getData('health') <= 0) {
        enemy.destroy();
    }
});
```

### Advanced Usage Patterns

```javascript { .api }
// Combine multiple actions
const powerUps = scene.add.group();
for (let i = 0; i < 8; i++) {
    powerUps.create(0, 0, 'powerup');
}

// Apply multiple transformations
Phaser.Actions.PlaceOnCircle(powerUps.children.entries, new Phaser.Geom.Circle(400, 300, 150));
Phaser.Actions.SetScale(powerUps.children.entries, 0.5, 0.1);  // Scale from 0.5 to 1.3
Phaser.Actions.SetRotation(powerUps.children.entries, 0, Math.PI / 4); // Rotate each differently
Phaser.Actions.SetDepth(powerUps.children.entries, 100);

// Conditional actions based on properties
function applyToVisibleObjects(gameObjects, action, ...params) {
    const visibleObjects = gameObjects.filter(obj => obj.visible);
    action(visibleObjects, ...params);
}

applyToVisibleObjects(enemies, Phaser.Actions.SetTint, 0xff0000);

// Animated sequences using actions
function createFormation(objects, formationType) {
    switch(formationType) {
        case 'circle':
            Phaser.Actions.PlaceOnCircle(objects, new Phaser.Geom.Circle(400, 300, 150));
            break;
        case 'line':
            Phaser.Actions.PlaceOnLine(objects, new Phaser.Geom.Line(100, 300, 700, 300));
            break;
        case 'grid':
            Phaser.Actions.GridAlign(objects, {
                width: Math.ceil(Math.sqrt(objects.length)),
                height: Math.ceil(Math.sqrt(objects.length)),
                cellWidth: 80,
                cellHeight: 80,
                x: 200,
                y: 200
            });
            break;
    }
}

// Performance optimization: Batch operations
function optimizedBulkUpdate(gameObjects) {
    // Collect all operations and apply them in batches
    const operations = [];
    
    operations.push(() => Phaser.Actions.IncY(gameObjects, -2)); // Move up
    operations.push(() => Phaser.Actions.Rotate(gameObjects, 0.01)); // Rotate slightly
    operations.push(() => Phaser.Actions.IncAlpha(gameObjects, -0.001)); // Fade out
    
    // Execute all operations
    operations.forEach(operation => operation());
    
    // Remove invisible objects
    const visibleObjects = gameObjects.filter(obj => obj.alpha > 0);
    return visibleObjects;
}
```

### Integration with Groups and Physics

```javascript { .api }
// Using with Phaser Groups
const bullets = scene.add.group();
const enemies = scene.add.group();

// Create bullets in formation
for (let i = 0; i < 5; i++) {
    bullets.create(100, 300, 'bullet');
}

// Arrange bullets and set properties
Phaser.Actions.PlaceOnLine(bullets.children.entries, new Phaser.Geom.Line(100, 300, 500, 300));
Phaser.Actions.PropertyValueSet(bullets.children.entries, 'speed', 200, 50); // Varying speeds

// Physics integration
const physicsSprites = scene.physics.add.group();
for (let i = 0; i < 10; i++) {
    physicsSprites.create(Phaser.Math.Between(100, 700), 100, 'falling_object');
}

// Set physics properties using actions
Phaser.Actions.Call(physicsSprites.children.entries, function(sprite) {
    sprite.body.setVelocityY(Phaser.Math.Between(100, 300));
    sprite.body.setBounce(0.8);
});
```

## Types

```javascript { .api }
// Action Function Signatures
namespace Phaser.Actions {
    // Positioning
    function SetX(items: any[], value: number, step?: number, index?: number, direction?: number): any[];
    function SetY(items: any[], value: number, step?: number, index?: number, direction?: number): any[];
    function SetXY(items: any[], x: number, y?: number, stepX?: number, stepY?: number, indexX?: number, indexY?: number, directionX?: number, directionY?: number): any[];
    function IncX(items: any[], value: number, index?: number, direction?: number): any[];
    function IncY(items: any[], value: number, index?: number, direction?: number): any[];
    function IncXY(items: any[], x: number, y?: number, index?: number, direction?: number): any[];
    
    // Geometric Placement
    function PlaceOnCircle(items: any[], circle: Phaser.Geom.Circle, startAngle?: number, endAngle?: number): any[];
    function PlaceOnEllipse(items: any[], ellipse: Phaser.Geom.Ellipse, startAngle?: number, endAngle?: number): any[];
    function PlaceOnLine(items: any[], line: Phaser.Geom.Line): any[];
    function PlaceOnRectangle(items: any[], rect: Phaser.Geom.Rectangle, shift?: number): any[];
    function PlaceOnTriangle(items: any[], triangle: Phaser.Geom.Triangle, stepRate?: number): any[];
    
    // Random Placement
    function RandomCircle(items: any[], circle: Phaser.Geom.Circle): any[];
    function RandomEllipse(items: any[], ellipse: Phaser.Geom.Ellipse): any[];
    function RandomLine(items: any[], line: Phaser.Geom.Line): any[];
    function RandomRectangle(items: any[], rect: Phaser.Geom.Rectangle): any[];
    function RandomTriangle(items: any[], triangle: Phaser.Geom.Triangle): any[];
    function Shuffle(items: any[]): any[];
    
    // Visual Properties
    function SetAlpha(items: any[], value: number, step?: number, index?: number, direction?: number): any[];
    function SetScale(items: any[], scaleX: number, scaleY?: number, stepX?: number, stepY?: number, index?: number, direction?: number): any[];
    function SetRotation(items: any[], value: number, step?: number, index?: number, direction?: number): any[];
    function SetTint(items: any[], topLeft: number, topRight?: number, bottomLeft?: number, bottomRight?: number): any[];
    function SetVisible(items: any[], value: boolean, index?: number, direction?: number): any[];
    
    // Utility
    function Call(items: any[], callback: string | function, ...args: any[]): any[];
    function GetFirst(items: any[], compare: object, index?: number): any;
    function GetLast(items: any[], compare: object, index?: number): any;
    function PropertyValueSet(items: any[], key: string, value: any, step?: number, index?: number, direction?: number): any[];
    function PropertyValueInc(items: any[], key: string, value: any, step?: number, index?: number, direction?: number): any[];
}
```