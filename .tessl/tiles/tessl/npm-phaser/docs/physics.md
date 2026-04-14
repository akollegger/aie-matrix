# Physics Systems

Phaser provides two powerful physics engines: Arcade Physics for fast, simple 2D collision detection, and Matter.js for realistic physics simulation. Choose the system that best fits your game's requirements.

## Arcade Physics

### World Setup
Arcade Physics provides a lightweight system perfect for most 2D games:

```javascript { .api }
// Game configuration with Arcade Physics
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 300 },
            debug: false,
            debugShowBody: true,
            debugShowStaticBody: true,
            debugShowVelocity: true,
            debugVelocityColor: 0x00ff00,
            debugBodyColor: 0xff0000,
            debugStaticBodyColor: 0x0000ff
        }
    },
    scene: GameScene
};

class GameScene extends Phaser.Scene {
    create() {
        // Access physics world
        const world = this.physics.world;
        
        // World properties
        console.log('Gravity:', world.gravity.x, world.gravity.y);
        console.log('Bounds:', world.bounds);
        console.log('Bodies count:', world.bodies.size);
        
        // World bounds collision
        world.setBoundsCollision(true, true, true, false); // left, right, top, bottom
        
        // Custom world bounds
        world.setBounds(0, 0, 1200, 800);
        
        // Pause/resume physics
        world.pause();
        world.resume();
    }
}
```

### Physics Bodies
Add physics to game objects:

```javascript { .api }
class PhysicsBodiesScene extends Phaser.Scene {
    create() {
        // Create physics-enabled sprites
        this.player = this.physics.add.sprite(100, 100, 'player');
        this.enemy = this.physics.add.sprite(300, 100, 'enemy');
        
        // Static bodies (don't move)
        this.platform = this.physics.add.staticSprite(400, 500, 'platform');
        
        // Add physics to existing sprite
        this.existingSprite = this.add.sprite(200, 200, 'item');
        this.physics.add.existing(this.existingSprite);
        
        // Body configuration
        this.player.setCollideWorldBounds(true);
        this.player.setBounce(0.2);
        this.player.setDrag(100);
        
        // Body size and offset
        this.player.body.setSize(20, 30);           // Custom collision size
        this.player.body.setOffset(6, 2);          // Offset from sprite origin
        this.player.body.setCircle(15);            // Circular collision shape
        
        // Velocity
        this.player.setVelocity(100, -300);
        this.player.setVelocityX(150);
        this.player.setVelocityY(-200);
        
        // Acceleration
        this.player.setAcceleration(50, 0);
        this.player.setMaxVelocity(200, 400);
        
        // Angular motion
        this.player.setAngularVelocity(90); // degrees per second
        this.player.setAngularAcceleration(45);
        this.player.setAngularDrag(30);
        
        // Mass and immovable
        this.player.body.mass = 2;
        this.platform.body.immovable = true;
    }
    
    update() {
        // Check body properties
        console.log('Player velocity:', this.player.body.velocity);
        console.log('On floor:', this.player.body.onFloor());
        console.log('On wall:', this.player.body.onWall());
        console.log('Blocked down:', this.player.body.blocked.down);
        
        // Manual velocity control
        if (this.cursors.left.isDown) {
            this.player.setVelocityX(-160);
        } else if (this.cursors.right.isDown) {
            this.player.setVelocityX(160);
        } else {
            this.player.setVelocityX(0);
        }
        
        // Jumping
        if (this.cursors.up.isDown && this.player.body.touching.down) {
            this.player.setVelocityY(-330);
        }
    }
}
```

### Collision Detection
Handle collisions between physics objects:

```javascript { .api }
class CollisionScene extends Phaser.Scene {
    create() {
        // Create game objects
        this.player = this.physics.add.sprite(100, 450, 'player');
        this.platforms = this.physics.add.staticGroup();
        this.enemies = this.physics.add.group();
        this.collectibles = this.physics.add.group();
        
        // Add platforms
        this.platforms.create(400, 568, 'ground').setScale(2).refreshBody();
        this.platforms.create(600, 400, 'platform');
        this.platforms.create(50, 250, 'platform');
        
        // Basic collision
        this.physics.add.collider(this.player, this.platforms);
        
        // Collision with callback
        this.physics.add.collider(this.player, this.enemies, this.hitEnemy, null, this);
        
        // Overlap detection (no collision response)
        this.physics.add.overlap(this.player, this.collectibles, this.collectItem, null, this);
        
        // Collision with process callback (return true to separate)
        this.physics.add.collider(this.player, this.enemies, 
            this.hitEnemy,      // Collision callback
            this.processHit,    // Process callback (can prevent collision)
            this
        );
        
        // Group vs group collisions
        this.physics.add.collider(this.enemies, this.platforms);
        this.physics.add.collider(this.enemies, this.enemies);
        
        // World bounds collision
        this.physics.add.collider(this.player, this.physics.world.bounds);
    }
    
    hitEnemy(player, enemy) {
        console.log('Player hit enemy!');
        enemy.setTint(0xff0000);
        
        // Bounce player away
        if (player.x < enemy.x) {
            player.setVelocityX(-200);
        } else {
            player.setVelocityX(200);
        }
        
        // Damage player
        this.playerHealth -= 10;
    }
    
    processHit(player, enemy) {
        // Only allow collision if player is attacking
        return this.playerIsAttacking;
    }
    
    collectItem(player, item) {
        item.destroy();
        this.score += 10;
        
        // Play collection effect
        this.tweens.add({
            targets: player,
            scaleX: 1.2,
            scaleY: 1.2,
            duration: 100,
            yoyo: true
        });
    }
}
```

### Groups and Physics
Manage collections of physics objects:

```javascript { .api }
class PhysicsGroupsScene extends Phaser.Scene {
    create() {
        // Static group (platforms, walls)
        this.platforms = this.physics.add.staticGroup();
        this.platforms.create(400, 568, 'ground');
        this.platforms.create(600, 400, 'platform');
        
        // Dynamic group (moving objects)
        this.enemies = this.physics.add.group({
            key: 'enemy',
            repeat: 5,
            setXY: { x: 100, y: 0, stepX: 100 }
        });
        
        // Group with physics configuration
        this.bullets = this.physics.add.group({
            defaultKey: 'bullet',
            maxSize: 20,
            runChildUpdate: true,
            createCallback: (bullet) => {
                bullet.body.onWorldBounds = true;
                bullet.body.world.on('worldbounds', (event, body) => {
                    if (body.gameObject === bullet) {
                        bullet.destroy();
                    }
                });
            }
        });
        
        // Group operations
        this.enemies.children.entries.forEach(enemy => {
            enemy.setBounce(1);
            enemy.setCollideWorldBounds(true);
            enemy.setVelocity(Phaser.Math.Between(-200, 200), 20);
        });
        
        // Batch physics properties
        Phaser.Actions.Call(this.enemies.children.entries, (enemy) => {
            enemy.setTint(Math.random() * 0xffffff);
        });
        
        // Create objects in group
        const newEnemy = this.enemies.create(300, 200, 'enemy');
        newEnemy.setVelocity(100, -100);
        
        // Get objects from group
        const firstEnemy = this.enemies.getFirst();
        const randomEnemy = this.enemies.getRandom();
        
        // Remove from group
        this.enemies.remove(newEnemy);
        this.enemies.killAndHide(randomEnemy);
    }
}
```

### Advanced Arcade Features
Additional Arcade Physics capabilities:

```javascript { .api }
class AdvancedArcadeScene extends Phaser.Scene {
    create() {
        this.player = this.physics.add.sprite(100, 450, 'player');
        this.platforms = this.physics.add.staticGroup();
        
        // One-way platforms
        const oneWayPlatform = this.platforms.create(400, 400, 'platform');
        oneWayPlatform.body.checkCollision.down = false;
        oneWayPlatform.body.checkCollision.left = false;
        oneWayPlatform.body.checkCollision.right = false;
        
        // Moving platforms
        const movingPlatform = this.physics.add.image(200, 300, 'platform');
        movingPlatform.setImmovable(true);
        movingPlatform.body.kinematic = true;
        movingPlatform.setVelocityX(50);
        
        // Conveyor belt effect
        const conveyorBelt = this.platforms.create(600, 500, 'conveyor');
        this.physics.add.collider(this.player, conveyorBelt, (player, belt) => {
            player.setVelocityX(player.body.velocity.x + 50);
        });
        
        // Slopes (requires custom collision handling)
        this.slope = this.add.rectangle(400, 350, 200, 20, 0x00ff00);
        this.physics.add.existing(this.slope, true); // Static body
        
        // Custom separation
        this.physics.add.overlap(this.player, this.slope, this.handleSlope, null, this);
        
        // Body events
        this.physics.world.on('worldbounds', (event, body) => {
            console.log('Body hit world bounds:', body.gameObject);
            if (body.gameObject === this.player) {
                this.playerFellOff();
            }
        });
        
        // Custom physics step
        this.physics.world.on('worldstep', () => {
            // Custom physics logic runs every step
            this.applyCustomForces();
        });
    }
    
    handleSlope(player, slope) {
        // Custom slope physics
        const slopeAngle = Math.PI / 6; // 30 degrees
        const gravity = this.physics.world.gravity.y;
        
        if (player.body.touching.down) {
            const slopeForce = Math.sin(slopeAngle) * gravity;
            player.setAccelerationX(slopeForce);
        }
    }
    
    applyCustomForces() {
        // Apply wind force
        if (this.windActive) {
            this.player.body.velocity.x += this.windStrength;
        }
        
        // Apply water resistance
        if (this.playerInWater) {
            this.player.body.velocity.x *= 0.95;
            this.player.body.velocity.y *= 0.95;
        }
    }
}
```

## Matter.js Physics

### Matter World Setup
Matter.js provides realistic physics simulation:

```javascript { .api }
// Game configuration with Matter.js
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: 'matter',
        matter: {
            gravity: { x: 0, y: 1 },
            debug: {
                showAxes: false,
                showAngleIndicator: false,
                angleColor: 0xe81153,
                showBody: true,
                showStaticBody: true,
                showVelocity: true,
                bodyColor: 0xffffff,
                bodyFillColor: 0xffffff,
                bodyLineWidth: 1,
                staticBodyColor: 0x0d177b,
                velocityColor: 0x00aeef,
                velocityLineWidth: 1,
                velocityLineLength: 20
            }
        }
    },
    scene: MatterScene
};

class MatterScene extends Phaser.Scene {
    create() {
        // Access Matter world
        const world = this.matter.world;
        
        // World configuration
        world.setBounds(0, 0, 800, 600);
        world.disableGravity(); // Disable gravity
        world.setGravity(0, 0.8); // Custom gravity
        
        // Engine properties
        const engine = world.engine;
        engine.world.gravity.scale = 0.001; // Gravity scale
        engine.timing.timeScale = 1; // Time scale
    }
}
```

### Matter Bodies
Create various physics bodies:

```javascript { .api }
class MatterBodiesScene extends Phaser.Scene {
    create() {
        // Rectangle body
        this.box = this.matter.add.rectangle(400, 200, 80, 80, {
            frictionAir: 0.01,
            friction: 0.1,
            frictionStatic: 0.5,
            restitution: 0.8,
            density: 0.001
        });
        
        // Circle body
        this.ball = this.matter.add.circle(100, 200, 30, {
            restitution: 0.9,
            density: 0.002
        });
        
        // Polygon body
        this.triangle = this.matter.add.polygon(600, 200, 3, 40, {
            angle: Math.PI / 6
        });
        
        // Trapezoid
        this.trapezoid = this.matter.add.trapezoid(300, 300, 80, 50, 0.5);
        
        // Complex shapes from vertices
        const star = this.matter.add.fromVertices(500, 300, [
            { x: 0, y: -20 },
            { x: 6, y: -6 },
            { x: 20, y: -6 },
            { x: 10, y: 2 },
            { x: 16, y: 16 },
            { x: 0, y: 8 },
            { x: -16, y: 16 },
            { x: -10, y: 2 },
            { x: -20, y: -6 },
            { x: -6, y: -6 }
        ]);
        
        // Sprite with Matter body
        this.player = this.matter.add.sprite(200, 100, 'player', null, {
            shape: {
                type: 'circle',
                radius: 16
            }
        });
        
        // Image with physics
        this.crate = this.matter.add.image(150, 300, 'crate');
        
        // Static bodies
        this.ground = this.matter.add.rectangle(400, 580, 800, 40, {
            isStatic: true
        });
        
        // Sensors (trigger areas)
        this.sensor = this.matter.add.rectangle(400, 100, 100, 50, {
            isSensor: true,
            render: {
                fillStyle: 'rgba(255, 255, 0, 0.5)'
            }
        });
    }
}
```

### Matter Constraints
Connect bodies with constraints:

```javascript { .api }
class MatterConstraintsScene extends Phaser.Scene {
    create() {
        // Create bodies
        const bodyA = this.matter.add.rectangle(300, 200, 50, 50);
        const bodyB = this.matter.add.rectangle(450, 200, 50, 50);
        const anchor = this.matter.add.rectangle(400, 100, 20, 20, { isStatic: true });
        
        // Basic constraint (rope/string)
        this.matter.add.constraint(bodyA, bodyB, 100, 0.7);
        
        // Constraint to world point
        this.matter.add.worldConstraint(anchor, 0, 0, {
            pointA: { x: 0, y: 0 },
            pointB: { x: 0, y: 0 },
            length: 200,
            stiffness: 0.8
        });
        
        // Spring constraint
        this.matter.add.constraint(bodyA, bodyB, 150, 0.1, {
            damping: 0.1,
            angularStiffness: 0,
            render: {
                lineWidth: 5,
                strokeStyle: '#90C695',
                type: 'spring'
            }
        });
        
        // Pin constraint (fixed point)
        this.matter.add.constraint(bodyA, anchor, 0, 1, {
            pointA: { x: 0, y: 0 },
            pointB: { x: 0, y: 0 }
        });
        
        // Mouse constraint (drag with mouse)
        this.matter.add.mouseSpring({
            length: 0.01,
            stiffness: 0.1
        });
        
        // Chain of bodies
        const chain = [];
        for (let i = 0; i < 5; i++) {
            chain.push(this.matter.add.rectangle(100 + i * 60, 300, 40, 40));
        }
        
        // Connect chain links
        for (let i = 0; i < chain.length - 1; i++) {
            this.matter.add.constraint(chain[i], chain[i + 1], 60, 0.9);
        }
    }
}
```

### Matter Events
Handle collision and constraint events:

```javascript { .api }
class MatterEventsScene extends Phaser.Scene {
    create() {
        // Create objects
        this.ball = this.matter.add.circle(400, 100, 30);
        this.ground = this.matter.add.rectangle(400, 580, 800, 40, { isStatic: true });
        
        // Collision events
        this.matter.world.on('collisionstart', (event) => {
            event.pairs.forEach((pair) => {
                const { bodyA, bodyB } = pair;
                console.log('Collision started between:', bodyA.label, bodyB.label);
                
                // Check specific collision
                if ((bodyA === this.ball.body && bodyB === this.ground.body) ||
                    (bodyB === this.ball.body && bodyA === this.ground.body)) {
                    this.ballHitGround();
                }
            });
        });
        
        this.matter.world.on('collisionactive', (event) => {
            // Collision is ongoing
            event.pairs.forEach((pair) => {
                console.log('Collision active');
            });
        });
        
        this.matter.world.on('collisionend', (event) => {
            // Collision ended
            event.pairs.forEach((pair) => {
                console.log('Collision ended');
            });
        });
        
        // Constraint events
        this.matter.world.on('constraintbreak', (event) => {
            console.log('Constraint broke:', event.constraint);
        });
        
        // Before/after update events
        this.matter.world.on('beforeupdate', () => {
            // Custom physics logic before engine update
        });
        
        this.matter.world.on('afterupdate', () => {
            // Custom physics logic after engine update
        });
        
        // Sleep events
        this.matter.world.on('sleepstart', (event) => {
            console.log('Body went to sleep:', event.source);
        });
        
        this.matter.world.on('sleepend', (event) => {
            console.log('Body woke up:', event.source);
        });
    }
    
    ballHitGround() {
        // Create impact effect
        this.tweens.add({
            targets: this.ball,
            scaleX: 1.2,
            scaleY: 0.8,
            duration: 100,
            yoyo: true
        });
    }
}
```

### Advanced Matter Features
Complex Matter.js functionality:

```javascript { .api }
class AdvancedMatterScene extends Phaser.Scene {
    create() {
        // Composite bodies (multiple shapes as one body)
        const carBody = this.matter.add.rectangle(400, 200, 100, 50);
        const wheelA = this.matter.add.circle(350, 225, 25);
        const wheelB = this.matter.add.circle(450, 225, 25);
        
        // Create car composite
        const car = this.matter.body.create({
            parts: [carBody, wheelA, wheelB]
        });
        this.matter.world.add(car);
        
        // Body modification
        this.matter.body.scale(this.ball.body, 1.5, 1.5);
        this.matter.body.rotate(this.box.body, Math.PI / 4);
        this.matter.body.translate(this.triangle.body, { x: 100, y: -50 });
        
        // Apply forces
        this.matter.body.applyForce(this.ball.body, 
            this.ball.body.position, 
            { x: 0.05, y: -0.1 }
        );
        
        // Set velocity directly
        this.matter.body.setVelocity(this.ball.body, { x: 5, y: -10 });
        this.matter.body.setAngularVelocity(this.box.body, 0.1);
        
        // Body properties
        this.matter.body.setMass(this.ball.body, 10);
        this.matter.body.setDensity(this.box.body, 0.002);
        this.matter.body.setInertia(this.triangle.body, Infinity); // Prevent rotation
        
        // Collision filtering
        const categoryA = 0x0001;
        const categoryB = 0x0002;
        const categoryC = 0x0004;
        
        // Bodies in category A collide with B and C
        this.ball.body.collisionFilter = {
            category: categoryA,
            mask: categoryB | categoryC
        };
        
        // Bodies in category B only collide with A
        this.box.body.collisionFilter = {
            category: categoryB,
            mask: categoryA
        };
        
        // Raycast
        const rayCast = this.matter.world.raycast(
            { x: 100, y: 100 },  // Start point
            { x: 700, y: 500 }   // End point
        );
        
        if (rayCast.length > 0) {
            console.log('Ray hit:', rayCast[0].body);
        }
        
        // Query region
        const bodiesInRegion = this.matter.world.query({
            x: 300, y: 200,
            width: 200, height: 100
        });
        
        console.log('Bodies in region:', bodiesInRegion);
    }
}
```

## Performance Optimization

### Physics Performance Tips
Optimize physics performance:

```javascript { .api }
class PhysicsOptimizationScene extends Phaser.Scene {
    create() {
        // Limit physics bodies
        const maxBodies = 100;
        
        // Use object pooling for bullets/particles
        this.bulletPool = this.physics.add.group({
            maxSize: 20,
            runChildUpdate: true
        });
        
        // Disable bodies when off-screen
        this.physics.world.on('worldstep', () => {
            this.enemies.children.entries.forEach(enemy => {
                if (!this.cameras.main.worldView.contains(enemy.x, enemy.y)) {
                    enemy.body.enable = false;
                } else {
                    enemy.body.enable = true;
                }
            });
        });
        
        // Use static bodies for non-moving objects
        const staticPlatforms = this.physics.add.staticGroup();
        
        // Reduce physics iterations for better performance
        // (Matter.js only)
        if (this.matter) {
            this.matter.world.engine.positionIterations = 6; // Default: 6
            this.matter.world.engine.velocityIterations = 4; // Default: 4
            this.matter.world.engine.constraintIterations = 2; // Default: 2
        }
        
        // Use collision categories to reduce collision checks
        // (Matter.js only)
        const playerCategory = 0x0001;
        const enemyCategory = 0x0002;
        const platformCategory = 0x0004;
        
        // Sleep inactive bodies (Matter.js)
        if (this.matter) {
            this.matter.world.engine.enableSleeping = true;
        }
    }
}
```

This comprehensive physics system provides both simple collision detection for arcade-style games and realistic physics simulation for more complex interactions, giving developers the flexibility to choose the right tool for their game's needs.