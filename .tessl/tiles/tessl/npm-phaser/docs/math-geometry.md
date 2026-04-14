# Math and Geometry

Phaser provides an extensive mathematical library including vector operations, geometric shapes, intersection testing, interpolation functions, and mathematical utilities. These tools are essential for game physics, graphics, and general mathematical operations.

## Math Utilities

### Core Math Functions
Essential mathematical operations and utilities:

```javascript { .api }
// Basic mathematical functions
const result1 = Phaser.Math.Average([1, 2, 3, 4, 5]);              // 3
const result2 = Phaser.Math.Clamp(150, 0, 100);                    // 100
const result3 = Phaser.Math.Distance.Between(0, 0, 100, 100);      // 141.42...
const result4 = Phaser.Math.Linear(0, 10, 0.5);                    // 5

// Angle calculations
const angle1 = Phaser.Math.Angle.Between(0, 0, 100, 100);          // π/4
const angle2 = Phaser.Math.DegToRad(90);                           // π/2
const angle3 = Phaser.Math.RadToDeg(Math.PI);                      // 180

// Random number generation
const random1 = Phaser.Math.Between(1, 10);                        // Random int 1-10
const random2 = Phaser.Math.FloatBetween(0, 1);                    // Random float 0-1

// Range and percentage
const percent = Phaser.Math.Percent(50, 0, 100);                   // 0.5
const value = Phaser.Math.FromPercent(0.75, 0, 200);              // 150

// Wrapping and snapping
const wrapped = Phaser.Math.Wrap(270, 0, 360);                     // 270
const snapped = Phaser.Math.Snap.To(127, 50);                      // 150
```

### Vector Mathematics
Work with 2D, 3D, and 4D vectors:

```javascript { .api }
class VectorMathScene extends Phaser.Scene {
    create() {
        // Vector2 operations
        const vec2a = new Phaser.Math.Vector2(3, 4);
        const vec2b = new Phaser.Math.Vector2(1, 2);
        
        // Basic vector operations
        const sum = vec2a.clone().add(vec2b);              // (4, 6)
        const diff = vec2a.clone().subtract(vec2b);        // (2, 2)
        const scaled = vec2a.clone().scale(2);             // (6, 8)
        const normalized = vec2a.clone().normalize();       // Unit vector
        
        // Vector properties
        console.log('Length:', vec2a.length());            // 5
        console.log('Angle:', vec2a.angle());              // 0.927... radians
        console.log('Dot product:', vec2a.dot(vec2b));     // 11
        console.log('Cross product:', vec2a.cross(vec2b)); // 2
        
        // Vector manipulation
        vec2a.setLength(10);        // Set to specific length
        vec2a.setAngle(Math.PI/4);  // Set to specific angle
        vec2a.rotate(Math.PI/6);    // Rotate by angle
        vec2a.lerp(vec2b, 0.5);     // Linear interpolation
        
        // Vector3 for 3D operations
        const vec3 = new Phaser.Math.Vector3(1, 2, 3);
        vec3.cross(new Phaser.Math.Vector3(4, 5, 6));
        vec3.project(new Phaser.Math.Vector3(1, 0, 0));
        
        // Vector4 for 4D operations (homogeneous coordinates)
        const vec4 = new Phaser.Math.Vector4(1, 2, 3, 1);
        vec4.transformMat4(transformMatrix);
    }
}
```

### Matrix Operations
Handle transformation matrices:

```javascript { .api }
class MatrixMathScene extends Phaser.Scene {
    create() {
        // Matrix3 for 2D transformations
        const matrix3 = new Phaser.Math.Matrix3();
        
        // Matrix operations
        matrix3.identity();                    // Reset to identity
        matrix3.translate(100, 50);           // Translation
        matrix3.rotate(Math.PI / 4);          // Rotation
        matrix3.scale(2, 1.5);                // Scaling
        
        // Transform points
        const point = new Phaser.Math.Vector2(10, 20);
        matrix3.transformPoint(point.x, point.y, point);
        
        // Matrix combination
        const transform1 = new Phaser.Math.Matrix3();
        const transform2 = new Phaser.Math.Matrix3();
        transform1.multiply(transform2);      // Combine transformations
        
        // Matrix4 for 3D transformations
        const matrix4 = new Phaser.Math.Matrix4();
        matrix4.perspective(75, 1.33, 0.1, 1000);  // Perspective projection
        matrix4.lookAt(
            new Phaser.Math.Vector3(0, 0, 5),      // Eye position
            new Phaser.Math.Vector3(0, 0, 0),      // Target
            new Phaser.Math.Vector3(0, 1, 0)       // Up vector
        );
        
        // Extract transformation components
        const position = new Phaser.Math.Vector3();
        const rotation = new Phaser.Math.Quaternion();
        const scale = new Phaser.Math.Vector3();
        matrix4.decompose(position, rotation, scale);
    }
}
```

### Quaternions
Handle 3D rotations with quaternions:

```javascript { .api }
class QuaternionScene extends Phaser.Scene {
    create() {
        // Create quaternions
        const quat1 = new Phaser.Math.Quaternion();
        const quat2 = new Phaser.Math.Quaternion(0, 0, 0, 1);
        
        // Set rotations
        quat1.setFromEuler(Math.PI/4, 0, 0);          // From Euler angles
        quat2.setFromAxisAngle(                       // From axis-angle
            new Phaser.Math.Vector3(0, 1, 0),        // Axis
            Math.PI / 2                               // Angle
        );
        
        // Quaternion operations
        const combined = quat1.clone().multiply(quat2);  // Combine rotations
        const interpolated = quat1.clone().slerp(quat2, 0.5);  // Spherical interpolation
        
        // Convert back to other formats
        const eulerAngles = quat1.toEuler();
        const rotationMatrix = new Phaser.Math.Matrix4();
        rotationMatrix.fromQuat(quat1);
        
        // Rotate vectors
        const vector = new Phaser.Math.Vector3(1, 0, 0);
        quat1.transformVector3(vector);
    }
}
```

## Geometric Shapes

### Basic Shapes
Work with fundamental geometric shapes:

```javascript { .api }
class BasicShapesScene extends Phaser.Scene {
    create() {
        // Rectangle
        const rect = new Phaser.Geom.Rectangle(50, 50, 100, 75);
        
        // Rectangle operations
        console.log('Area:', Phaser.Geom.Rectangle.Area(rect));           // 7500
        console.log('Perimeter:', Phaser.Geom.Rectangle.Perimeter(rect)); // 350
        console.log('Contains point:', Phaser.Geom.Rectangle.Contains(rect, 75, 75)); // true
        
        // Rectangle manipulation
        Phaser.Geom.Rectangle.CenterOn(rect, 400, 300);    // Center at point
        Phaser.Geom.Rectangle.Inflate(rect, 20, 10);       // Increase size
        
        // Circle
        const circle = new Phaser.Geom.Circle(200, 200, 50);
        
        // Circle operations
        console.log('Circumference:', Phaser.Geom.Circle.Circumference(circle));
        console.log('Area:', Phaser.Geom.Circle.Area(circle));
        
        // Get points on circle
        const point = Phaser.Geom.Circle.CircumferencePoint(circle, Math.PI/4);
        const randomPoint = Phaser.Geom.Circle.Random(circle);
        
        // Line
        const line = new Phaser.Geom.Line(0, 0, 100, 100);
        
        // Line operations
        console.log('Length:', Phaser.Geom.Line.Length(line));
        console.log('Angle:', Phaser.Geom.Line.Angle(line));
        const midpoint = Phaser.Geom.Line.GetMidPoint(line);
        
        // Triangle
        const triangle = new Phaser.Geom.Triangle(100, 100, 150, 50, 200, 100);
        
        // Triangle operations
        console.log('Area:', Phaser.Geom.Triangle.Area(triangle));
        const centroid = Phaser.Geom.Triangle.Centroid(triangle);
        const circumcircle = Phaser.Geom.Triangle.CircumCircle(triangle);
        
        // Polygon
        const polygon = new Phaser.Geom.Polygon([
            100, 100,  // Point 1
            150, 50,   // Point 2
            200, 100,  // Point 3
            175, 150,  // Point 4
            125, 150   // Point 5
        ]);
        
        // Polygon operations
        console.log('Contains point:', Phaser.Geom.Polygon.Contains(polygon, 150, 100));
        const bounds = Phaser.Geom.Polygon.GetAABB(polygon);
        const simplified = Phaser.Geom.Polygon.Simplify(polygon);
    }
}
```

### Advanced Shape Operations
Complex geometric operations and transformations:

```javascript { .api }
class AdvancedShapesScene extends Phaser.Scene {
    create() {
        // Ellipse
        const ellipse = new Phaser.Geom.Ellipse(300, 200, 120, 80);
        
        // Get points on ellipse perimeter
        const ellipsePoints = Phaser.Geom.Ellipse.GetPoints(ellipse, 32);
        
        // Point utilities
        const points = [
            new Phaser.Geom.Point(100, 100),
            new Phaser.Geom.Point(200, 150),
            new Phaser.Geom.Point(300, 120),
            new Phaser.Geom.Point(150, 200)
        ];
        
        // Point operations
        const centroid = Phaser.Geom.Point.GetCentroid(points);
        const boundingRect = Phaser.Geom.Point.GetRectangleFromPoints(points);
        
        // Interpolate between points
        const interpolated = Phaser.Geom.Point.Interpolate(
            points[0], points[1], 0.5
        );
        
        // Complex polygon from points
        const complexPolygon = new Phaser.Geom.Polygon(points);
        
        // Triangulate polygon (for rendering)
        const triangles = Phaser.Geom.Polygon.Earcut(complexPolygon.points);
        
        // Smooth polygon edges
        const smoothed = Phaser.Geom.Polygon.Smooth(complexPolygon);
        
        // Create shapes for rendering
        this.createShapeVisuals(ellipse, complexPolygon, triangles);
    }
    
    createShapeVisuals(ellipse, polygon, triangles) {
        const graphics = this.add.graphics();
        
        // Draw ellipse
        graphics.lineStyle(2, 0xff0000);
        graphics.strokeEllipse(ellipse.x, ellipse.y, ellipse.width, ellipse.height);
        
        // Draw polygon
        graphics.lineStyle(2, 0x00ff00);
        graphics.beginPath();
        graphics.moveTo(polygon.points[0].x, polygon.points[0].y);
        for (let i = 1; i < polygon.points.length; i++) {
            graphics.lineTo(polygon.points[i].x, polygon.points[i].y);
        }
        graphics.closePath();
        graphics.strokePath();
        
        // Draw triangulated polygon
        graphics.fillStyle(0x0000ff, 0.3);
        for (let i = 0; i < triangles.length; i += 3) {
            const p1 = polygon.points[triangles[i]];
            const p2 = polygon.points[triangles[i + 1]];
            const p3 = polygon.points[triangles[i + 2]];
            
            graphics.fillTriangle(
                p1.x, p1.y,
                p2.x, p2.y,
                p3.x, p3.y
            );
        }
    }
}
```

## Intersection and Collision Testing

### Shape Intersection
Test intersections between various geometric shapes:

```javascript { .api }
class IntersectionScene extends Phaser.Scene {
    create() {
        // Create test shapes
        const rect1 = new Phaser.Geom.Rectangle(100, 100, 100, 80);
        const rect2 = new Phaser.Geom.Rectangle(150, 120, 100, 80);
        const circle1 = new Phaser.Geom.Circle(250, 200, 50);
        const circle2 = new Phaser.Geom.Circle(300, 180, 40);
        const line = new Phaser.Geom.Line(50, 50, 350, 300);
        
        // Rectangle vs Rectangle
        const rectOverlap = Phaser.Geom.Intersects.RectangleToRectangle(rect1, rect2);
        console.log('Rectangles overlap:', rectOverlap);
        
        // Get intersection area
        const intersection = Phaser.Geom.Intersects.GetRectangleIntersection(rect1, rect2);
        if (intersection) {
            console.log('Intersection area:', Phaser.Geom.Rectangle.Area(intersection));
        }
        
        // Circle vs Circle
        const circleOverlap = Phaser.Geom.Intersects.CircleToCircle(circle1, circle2);
        console.log('Circles overlap:', circleOverlap);
        
        // Circle vs Rectangle
        const circleRectOverlap = Phaser.Geom.Intersects.CircleToRectangle(circle1, rect1);
        console.log('Circle and rectangle overlap:', circleRectOverlap);
        
        // Line intersections
        const lineCirclePoints = Phaser.Geom.Intersects.GetLineToCircle(line, circle1);
        console.log('Line-circle intersection points:', lineCirclePoints);
        
        const lineRectPoints = Phaser.Geom.Intersects.GetLineToRectangle(line, rect1);
        console.log('Line-rectangle intersection points:', lineRectPoints);
        
        // Point in shape testing
        const pointInRect = Phaser.Geom.Rectangle.Contains(rect1, 150, 140);
        const pointInCircle = Phaser.Geom.Circle.Contains(circle1, 260, 210);
        
        // Triangle intersections
        const triangle = new Phaser.Geom.Triangle(200, 50, 250, 25, 300, 75);
        const triangleCircle = Phaser.Geom.Intersects.TriangleToCircle(triangle, circle1);
        const triangleRect = Phaser.Geom.Intersects.TriangleToTriangle(triangle, triangle);
        
        // Visualize intersections
        this.visualizeIntersections(rect1, rect2, circle1, circle2, line, triangle);
    }
    
    visualizeIntersections(rect1, rect2, circle1, circle2, line, triangle) {
        const graphics = this.add.graphics();
        
        // Draw rectangles
        graphics.lineStyle(2, 0xff0000);
        graphics.strokeRectShape(rect1);
        graphics.strokeRectShape(rect2);
        
        // Draw circles
        graphics.lineStyle(2, 0x00ff00);
        graphics.strokeCircleShape(circle1);
        graphics.strokeCircleShape(circle2);
        
        // Draw line
        graphics.lineStyle(2, 0x0000ff);
        graphics.strokeLineShape(line);
        
        // Draw triangle
        graphics.lineStyle(2, 0xff00ff);
        graphics.strokeTriangleShape(triangle);
        
        // Highlight intersections
        if (Phaser.Geom.Intersects.RectangleToRectangle(rect1, rect2)) {
            const intersection = Phaser.Geom.Intersects.GetRectangleIntersection(rect1, rect2);
            graphics.fillStyle(0xffff00, 0.5);
            graphics.fillRectShape(intersection);
        }
    }
}
```

### Advanced Collision Detection
Implement more complex collision scenarios:

```javascript { .api }
class AdvancedCollisionScene extends Phaser.Scene {
    create() {
        // Moving objects for continuous collision detection
        this.movingCircle = {
            current: new Phaser.Geom.Circle(100, 100, 20),
            previous: new Phaser.Geom.Circle(90, 90, 20),
            velocity: new Phaser.Math.Vector2(5, 3)
        };
        
        this.staticRect = new Phaser.Geom.Rectangle(200, 150, 100, 80);
        
        // Swept collision detection
        this.checkSweptCollision();
        
        // Polygon collision detection
        this.polygon1 = new Phaser.Geom.Polygon([
            100, 300, 150, 280, 200, 320, 150, 350
        ]);
        
        this.polygon2 = new Phaser.Geom.Polygon([
            180, 290, 230, 270, 280, 310, 230, 340
        ]);
        
        const polyCollision = this.checkPolygonCollision(this.polygon1, this.polygon2);
        console.log('Polygon collision:', polyCollision);
        
        // Raycast collision detection
        this.performRaycast();
    }
    
    checkSweptCollision() {
        // Check if moving circle will collide with rectangle
        const futurePosition = new Phaser.Geom.Circle(
            this.movingCircle.current.x + this.movingCircle.velocity.x,
            this.movingCircle.current.y + this.movingCircle.velocity.y,
            this.movingCircle.current.radius
        );
        
        if (Phaser.Geom.Intersects.CircleToRectangle(futurePosition, this.staticRect)) {
            console.log('Collision predicted!');
            this.resolveCollision();
        }
    }
    
    resolveCollision() {
        // Simple collision response - bounce off rectangle
        const rectCenter = Phaser.Geom.Rectangle.GetCenter(this.staticRect);
        const circleCenter = new Phaser.Geom.Point(
            this.movingCircle.current.x,
            this.movingCircle.current.y
        );
        
        // Calculate collision normal
        const normal = new Phaser.Math.Vector2(
            circleCenter.x - rectCenter.x,
            circleCenter.y - rectCenter.y
        ).normalize();
        
        // Reflect velocity
        const dot = this.movingCircle.velocity.dot(normal);
        this.movingCircle.velocity.subtract(normal.clone().scale(2 * dot));
    }
    
    checkPolygonCollision(poly1, poly2) {
        // Separating Axis Theorem (SAT) implementation
        const getAxes = (polygon) => {
            const axes = [];
            for (let i = 0; i < polygon.points.length; i++) {
                const p1 = polygon.points[i];
                const p2 = polygon.points[(i + 1) % polygon.points.length];
                const edge = new Phaser.Math.Vector2(p2.x - p1.x, p2.y - p1.y);
                axes.push(new Phaser.Math.Vector2(-edge.y, edge.x).normalize());
            }
            return axes;
        };
        
        const project = (polygon, axis) => {
            let min = Infinity;
            let max = -Infinity;
            
            for (const point of polygon.points) {
                const dot = axis.dot(new Phaser.Math.Vector2(point.x, point.y));
                min = Math.min(min, dot);
                max = Math.max(max, dot);
            }
            
            return { min, max };
        };
        
        const axes = [...getAxes(poly1), ...getAxes(poly2)];
        
        for (const axis of axes) {
            const proj1 = project(poly1, axis);
            const proj2 = project(poly2, axis);
            
            if (proj1.max < proj2.min || proj2.max < proj1.min) {
                return false; // Separating axis found
            }
        }
        
        return true; // No separating axis found, collision detected
    }
    
    performRaycast() {
        // Ray from point to target
        const rayStart = new Phaser.Math.Vector2(50, 50);
        const rayEnd = new Phaser.Math.Vector2(350, 350);
        const rayDirection = rayEnd.clone().subtract(rayStart).normalize();
        
        // Test against various shapes
        const obstacles = [
            this.staticRect,
            this.movingCircle.current,
            this.polygon1
        ];
        
        let closestHit = null;
        let closestDistance = Infinity;
        
        obstacles.forEach(obstacle => {
            const hit = this.raycastToShape(rayStart, rayDirection, obstacle);
            if (hit && hit.distance < closestDistance) {
                closestDistance = hit.distance;
                closestHit = hit;
            }
        });
        
        if (closestHit) {
            console.log('Ray hit at:', closestHit.point);
        }
    }
    
    raycastToShape(rayStart, rayDirection, shape) {
        if (shape instanceof Phaser.Geom.Rectangle) {
            return this.raycastToRectangle(rayStart, rayDirection, shape);
        } else if (shape instanceof Phaser.Geom.Circle) {
            return this.raycastToCircle(rayStart, rayDirection, shape);
        }
        return null;
    }
    
    raycastToRectangle(rayStart, rayDirection, rect) {
        // Ray-rectangle intersection using slab method
        const invDir = new Phaser.Math.Vector2(1 / rayDirection.x, 1 / rayDirection.y);
        
        const t1 = (rect.x - rayStart.x) * invDir.x;
        const t2 = (rect.x + rect.width - rayStart.x) * invDir.x;
        const t3 = (rect.y - rayStart.y) * invDir.y;
        const t4 = (rect.y + rect.height - rayStart.y) * invDir.y;
        
        const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
        const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
        
        if (tmax < 0 || tmin > tmax) {
            return null; // No intersection
        }
        
        const t = tmin < 0 ? tmax : tmin;
        const hitPoint = rayStart.clone().add(rayDirection.clone().scale(t));
        
        return {
            point: hitPoint,
            distance: t,
            normal: this.getRectangleNormal(hitPoint, rect)
        };
    }
    
    raycastToCircle(rayStart, rayDirection, circle) {
        const toCircle = new Phaser.Math.Vector2(
            circle.x - rayStart.x,
            circle.y - rayStart.y
        );
        
        const a = rayDirection.dot(rayDirection);
        const b = -2 * rayDirection.dot(toCircle);
        const c = toCircle.dot(toCircle) - circle.radius * circle.radius;
        
        const discriminant = b * b - 4 * a * c;
        
        if (discriminant < 0) {
            return null; // No intersection
        }
        
        const t = (-b - Math.sqrt(discriminant)) / (2 * a);
        
        if (t < 0) {
            return null; // Behind ray start
        }
        
        const hitPoint = rayStart.clone().add(rayDirection.clone().scale(t));
        const normal = hitPoint.clone().subtract(new Phaser.Math.Vector2(circle.x, circle.y)).normalize();
        
        return {
            point: hitPoint,
            distance: t,
            normal: normal
        };
    }
    
    getRectangleNormal(point, rect) {
        const center = Phaser.Geom.Rectangle.GetCenter(rect);
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            return new Phaser.Math.Vector2(dx > 0 ? 1 : -1, 0);
        } else {
            return new Phaser.Math.Vector2(0, dy > 0 ? 1 : -1);
        }
    }
}
```

## Interpolation and Easing

### Interpolation Functions
Smooth transitions between values:

```javascript { .api }
class InterpolationScene extends Phaser.Scene {
    create() {
        // Linear interpolation
        const lerp1 = Phaser.Math.Linear(0, 100, 0.5);                    // 50
        const lerp2 = Phaser.Math.LinearXY(
            new Phaser.Math.Vector2(0, 0),
            new Phaser.Math.Vector2(100, 100),
            0.3
        ); // (30, 30)
        
        // Smooth step interpolation
        const smooth = Phaser.Math.SmoothStep(0.2, 0, 1);                 // Smooth curve
        const smoother = Phaser.Math.SmootherStep(0.7, 0, 1);             // Even smoother
        
        // Bezier interpolation
        const bezier = Phaser.Math.Interpolation.Bezier([0, 25, 75, 100], 0.5);
        
        // Catmull-Rom spline
        const catmull = Phaser.Math.Interpolation.CatmullRom([0, 20, 80, 100], 0.4);
        
        // Cubic Bezier curve
        const cubic = Phaser.Math.Interpolation.CubicBezier(0.3, 0, 0.2, 1, 0.8);
        
        // Demonstrate interpolation with moving object
        this.demonstrateInterpolation();
    }
    
    demonstrateInterpolation() {
        const sprite = this.add.circle(100, 300, 10, 0xff0000);
        const startX = 100;
        const endX = 700;
        let progress = 0;
        
        // Create path points for complex interpolation
        const pathPoints = [
            { x: 100, y: 300 },
            { x: 200, y: 150 },
            { x: 400, y: 450 },
            { x: 600, y: 200 },
            { x: 700, y: 300 }
        ];
        
        this.tweens.add({
            targets: { progress: 0 },
            progress: 1,
            duration: 3000,
            repeat: -1,
            yoyo: true,
            onUpdate: (tween) => {
                const t = tween.getValue();
                
                // Linear interpolation for comparison
                const linearX = Phaser.Math.Linear(startX, endX, t);
                
                // Smooth step for eased movement
                const smoothT = Phaser.Math.SmoothStep(t, 0, 1);
                const smoothX = Phaser.Math.Linear(startX, endX, smoothT);
                
                // Catmull-Rom spline through path points
                const splineIndex = t * (pathPoints.length - 1);
                const segmentIndex = Math.floor(splineIndex);
                const segmentT = splineIndex - segmentIndex;
                
                if (segmentIndex < pathPoints.length - 1) {
                    const p0 = pathPoints[Math.max(0, segmentIndex - 1)];
                    const p1 = pathPoints[segmentIndex];
                    const p2 = pathPoints[segmentIndex + 1];
                    const p3 = pathPoints[Math.min(pathPoints.length - 1, segmentIndex + 2)];
                    
                    const splineX = this.catmullRomInterpolate(p0.x, p1.x, p2.x, p3.x, segmentT);
                    const splineY = this.catmullRomInterpolate(p0.y, p1.y, p2.y, p3.y, segmentT);
                    
                    sprite.setPosition(splineX, splineY);
                }
            }
        });
    }
    
    catmullRomInterpolate(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        
        return 0.5 * (
            (2 * p1) +
            (-p0 + p2) * t +
            (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
            (-p0 + 3 * p1 - 3 * p2 + p3) * t3
        );
    }
}
```

### Easing Functions
Comprehensive easing function library:

```javascript { .api }
class EasingScene extends Phaser.Scene {
    create() {
        // Create sprites to demonstrate different easing functions
        const easingFunctions = [
            { name: 'Linear', func: Phaser.Math.Easing.Linear },
            { name: 'Quad.In', func: Phaser.Math.Easing.Quadratic.In },
            { name: 'Quad.Out', func: Phaser.Math.Easing.Quadratic.Out },
            { name: 'Quad.InOut', func: Phaser.Math.Easing.Quadratic.InOut },
            { name: 'Cubic.In', func: Phaser.Math.Easing.Cubic.In },
            { name: 'Cubic.Out', func: Phaser.Math.Easing.Cubic.Out },
            { name: 'Bounce.Out', func: Phaser.Math.Easing.Bounce.Out },
            { name: 'Elastic.Out', func: Phaser.Math.Easing.Elastic.Out },
            { name: 'Back.Out', func: Phaser.Math.Easing.Back.Out }
        ];
        
        easingFunctions.forEach((easing, index) => {
            const y = 50 + index * 60;
            const sprite = this.add.circle(50, y, 8, 0xff0000);
            const label = this.add.text(10, y - 20, easing.name, {
                fontSize: '12px',
                fill: '#ffffff'
            });
            
            // Animate with specific easing function
            this.tweens.add({
                targets: sprite,
                x: 750,
                duration: 2000,
                ease: easing.func,
                yoyo: true,
                repeat: -1,
                delay: index * 100
            });
        });
        
        // Custom easing function
        const customEasing = (t) => {
            // Bounce with custom parameters
            return Math.abs(Math.sin(t * Math.PI * 6)) * (1 - t);
        };
        
        const customSprite = this.add.circle(50, 600, 10, 0x00ff00);
        this.tweens.add({
            targets: customSprite,
            x: 750,
            duration: 3000,
            ease: customEasing,
            repeat: -1,
            yoyo: true
        });
        
        this.add.text(10, 580, 'Custom Easing', {
            fontSize: '12px',
            fill: '#00ff00'
        });
    }
}
```

## Random Number Generation

### Random Data Generator
Phaser's seedable random number generator:

```javascript { .api }
class RandomScene extends Phaser.Scene {
    create() {
        // Use global random generator
        const random1 = Phaser.Math.RND.between(1, 10);
        const random2 = Phaser.Math.RND.frac();              // 0-1
        const random3 = Phaser.Math.RND.pick(['a', 'b', 'c']); // Pick from array
        
        // Create seeded generator for reproducible randomness
        const seededRNG = new Phaser.Math.RandomDataGenerator(['seed1', 'seed2']);
        
        // Generate reproducible random numbers
        console.log('Seeded random:', seededRNG.between(1, 100));
        console.log('Seeded fraction:', seededRNG.frac());
        console.log('Seeded pick:', seededRNG.pick(['red', 'green', 'blue']));
        
        // Advanced random operations
        const weightedArray = [
            { value: 'common', weight: 0.7 },
            { value: 'uncommon', weight: 0.25 },
            { value: 'rare', weight: 0.05 }
        ];
        
        const weightedResult = seededRNG.weightedPick(weightedArray);
        console.log('Weighted pick:', weightedResult);
        
        // Shuffle array
        const deck = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        seededRNG.shuffle(deck);
        console.log('Shuffled deck:', deck);
        
        // Random vectors
        const randomVector2 = Phaser.Math.RandomXY(new Phaser.Math.Vector2());
        const randomVector3 = Phaser.Math.RandomXYZ(new Phaser.Math.Vector3());
        
        // Random rotation
        const angle = seededRNG.rotation(); // Random angle 0 to 2PI
        
        // Generate random colors
        this.generateRandomVisuals(seededRNG);
    }
    
    generateRandomVisuals(rng) {
        // Create random colored circles
        for (let i = 0; i < 20; i++) {
            const x = rng.between(50, 750);
            const y = rng.between(50, 550);
            const radius = rng.between(10, 30);
            const color = rng.integer(0x000000, 0xffffff);
            
            const circle = this.add.circle(x, y, radius, color);
            
            // Random animation
            this.tweens.add({
                targets: circle,
                scaleX: rng.realInRange(0.5, 2),
                scaleY: rng.realInRange(0.5, 2),
                rotation: rng.rotation(),
                duration: rng.between(1000, 3000),
                yoyo: true,
                repeat: -1,
                delay: rng.between(0, 1000)
            });
        }
        
        // Procedural generation example
        this.generateTerrain(rng);
    }
    
    generateTerrain(rng) {
        const graphics = this.add.graphics();
        graphics.fillStyle(0x8B4513); // Brown
        
        let height = 400;
        const roughness = 50;
        
        for (let x = 0; x < 800; x += 5) {
            // Random walk terrain generation
            height += rng.realInRange(-roughness, roughness);
            height = Phaser.Math.Clamp(height, 300, 500);
            
            graphics.fillRect(x, height, 5, 600 - height);
        }
    }
}
```

This comprehensive mathematical and geometric system provides all the tools needed for complex game mechanics, procedural generation, collision detection, and smooth animations.