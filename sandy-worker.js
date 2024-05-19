let elevationData;
let grains;
let size;
let width;
let height;
let steps;
let dragCoefficient;
let mouseX = 0;
let mouseY = 0;
let repelXMin = 0;
let repelXMax = 0;
let repelYMin = 0;
let repelYMax = 0;

let leftBound;
let rightBound;
let topBound;
let bottomBound;

let elevationXOffset;
let elevationYOffset;

let elevationXOffsetHalf;
let elevationYOffsetHalf;

// Define repel radius
let repelRadius;
let repelRadiusSquared;

let globalVx = 0;
let globalVy = 0;

let debug = false;

self.onmessage = (event) => {
    if (event.data.elevationData && event.data.grains) {
        // Initial data received
        elevationData = event.data.elevationData;
        grains = new Float32Array(event.data.grains);
        size = event.data.size;
        width = event.data.width;
        height = event.data.height;
        steps = parseFloat(event.data.steps);
        dragCoefficient = parseFloat(event.data.dragCoefficient);

        repelRadius = event.data.repelRadius;
        repelRadiusSquared = repelRadius * repelRadius;

        debug = event.data.debug;

        // For a normal 2D array, the offset is just "left" and "right" movements
        // Since we want to use the left and right borders of the grains for the gradient calculation,
        // we need to have the offset to be the inside border of a full grain
        elevationXOffset = size - 1;

        // The y offset is more interesting, since in a normal 2D array, the offset is "up" and "down" movements
        // Since we are using a 1D array, one "up" movement is the width of the elevation data
        // So to get the top and bottom borders of the grains for the gradient calculation,
        // we need to move up and down (width) by the size of the grains (inside border again)
        elevationYOffset = elevationXOffset;

        elevationXOffsetHalf = Math.floor(elevationXOffset / 2);
        elevationYOffsetHalf = Math.floor(elevationYOffset / 2);

        leftBound = 0;
        rightBound = width - size;
        topBound = 0;
        bottomBound = height - size;
    } else if (event.data.action === 'update') {
        mouseX = event.data.mouseX;
        mouseY = event.data.mouseY;

        repelXMin = mouseX - repelRadius;
        repelXMax = mouseX + repelRadius;
        repelYMin = mouseY - repelRadius;
        repelYMax = mouseY + repelRadius;

        globalVx = event.data.globalVx;
        globalVy = event.data.globalVy;

        // Update request received
        updateGrains();
    }
};

let totalElapsedTime = 0;
let totalFrames = 0;

function updateGrains() {
    const startTime = performance.now();

    // Create a deep copy of the elevation data using typed arrays
    // Using a Int16Array for faster access
    const elevationDataCopy = new Int8Array(elevationData);

    for (let i = 0; i < grains.length; i += 4) {
        const x = grains[i];
        const y = grains[i + 1];
        let vx = grains[i + 2];
        let vy = grains[i + 3];

        // Convert to integers for array indexing
        const xInt = Math.floor(x);
        const yInt = Math.floor(y);

        // The xInt and yInt are the top left corner of the grain
        // So rather calculate the gradient using the center bounds of each side
        const elevationValueLeft = getElevationValue(elevationDataCopy, xInt, yInt + elevationYOffsetHalf);
        const elevationValueRight = getElevationValue(elevationDataCopy, xInt + elevationXOffset, yInt + elevationYOffsetHalf);
        const elevationValueTop = getElevationValue(elevationDataCopy, xInt + elevationXOffsetHalf, yInt);
        const elevationValueBottom = getElevationValue(elevationDataCopy, xInt + elevationXOffsetHalf, yInt + elevationYOffset);

        // Calculate the gradient based on grain bounds
        const gradientX = elevationValueRight - elevationValueLeft;
        const gradientY = elevationValueBottom - elevationValueTop;

        vx += gradientX + globalVx;
        vy += gradientY + globalVy;

        // Repel from mouse if within repel radius
        if (x > repelXMin && x < repelXMax && y > repelYMin && y < repelYMax) {
            const dx = x - mouseX;
            const dy = y - mouseY;
            const distance = dx * dx + dy * dy;

            if (distance < repelRadiusSquared) {
                const repelFactor = Math.sqrt(distance);
                vx += dx * repelFactor;
                vy += dy * repelFactor;
            }
        }

        // Damper the velocity based on the size of the grain and the drag coefficient
        vx = Math.tanh(vx / size) * size * dragCoefficient;
        vy = Math.tanh(vy / size) * size * dragCoefficient;

        // Calculate the new position of the grain based on its velocity
        let newX = x + vx;
        let newY = y + vy;

        // Keep the grain within the canvas bounds and reverse its velocity if it crosses the edges
        if (newX < leftBound) {
            newX = leftBound;
            vx = -vx;
        } else if (newX > rightBound) {
            newX = rightBound;
            vx = -vx;
        }
        if (newY < topBound) {
            newY = topBound;
            vy = -vy;
        } else if (newY > bottomBound) {
            newY = bottomBound;
            vy = -vy;
        }

        // Subtract 1 from the elevation data copy below the grain
        const minX = Math.floor(newX);
        const maxX = Math.floor(newX + size);
        const minY = Math.floor(newY);
        const maxY = Math.floor(newY + size);

        for (let y = minY; y < maxY; y++) {
            const rowIndex = y * width;
            for (let x = minX; x < maxX; x++) {
                elevationDataCopy[rowIndex + x] -= 1;
            }
        }

        // Update the grain's position and velocity in the grains array
        grains[i] = newX;
        grains[i + 1] = newY;
        grains[i + 2] = vx;
        grains[i + 3] = vy;
    };

    self.postMessage({ grains: grains });

    if (debug) {
        const endTime = performance.now();
        totalElapsedTime += endTime - startTime;
        totalFrames++;

        if (totalFrames % 50 === 0) {
            const averageFPS = 1000 / (totalElapsedTime / totalFrames);
            console.log(`[${totalFrames}]`, 'updateGrains averageFPS', averageFPS);
        }
    }
}

function getElevationValue(data, x, y) {
    return data[y * width + x];
}