# Sandy Image Library

The Sandy Image Library creates mesmerizing sand animations by transforming static images into interactive grayscale sand art. Built with WebAssembly for high performance, it makes thousands of sand grains react smoothly to mouse/touch input while maintaining efficient CPU usage.

## Features

- WebAssembly-powered performance handles thousands of sand grains efficiently
- Converts images into interactive grayscale sand animations
- Dynamic sand grain physics - particles are repelled from mouse/touch input
- Smooth worker thread animation targeting 30 FPS
- Customizable options for grain size, animation steps, and breeze effects
- Small bundle size - only ships the necessary WASM code

## Installation

You can install the Sandy Image Library via npm:

```bash
npm install sandy-image
```

This will install both the JavaScript wrapper and the WebAssembly module. The library uses a worker thread to ensure smooth animations without impacting the main thread.

Alternatively, you can include the library files directly:

```html
<script src="path/to/sandy.js"></script>
<!-- The following files must be in the same directory:
  - sandy-worker.js: Handles animation calculations
  - sandy-image.js: The WebAssembly JavaScript glue code
  - sandy-image_bg.wasm: The WebAssembly module -->
```

## Usage

1. Create an instance of the SandyImage class, passing the selector of the target image and any desired options:

    ```javascript
    const sandyImage = new SandyImage('#myImage', {
        size: 6,
        steps: 5,
        // Other options...
    });
    ```

2. The library will automatically replace the target image with a canvas and start the sand animation.

3. Customize the animation by providing options during initialization. The available options include:
    - `size`: The pixel size of each sand grain (default: 5). Bigger sizes result in a faster animation but reduces the detail in the final image.
    - `steps`: The number of grayscale steps the image should be converted into (default: 5). Smaller steps result in a faster animation, but values lower than 5 tend to have clear grayscale steps.
    - `stepDepth`: The artificial "depth" added to each grayscale step (default: 3). This makes it possible to use bigger sizes and smaller steps by adding an artificial detail to the final image. It also helps grains to not be dislodged (by the mouse or breeze) from "deep" cuts easily. Values between 2 and 5 tend to work well.
    - `targetFPS`: The target frames per second for the animation (default: 30).
    - `dampingFactor`: The damping factor for sand movement (default: 0.95). Values should be between 0 and 1.
    - `repelRadius`: The radius within which sand particles are repelled by the mouse or touch input (default: 20).
    - `createGrainFn`: A custom function for creating sand grains. It takes an object with properties `canvasWidth`, `canvasHeight`, `size`, and `index` as input and should return an object with `x`, `y`, `vx`, and `vy` properties for the initial grain's position and velocity.
    - `breezeFn`: A custom function for applying a breeze effect to the animation. It takes an object with properties `frame`, `globalVx`, and `globalVy` as input and should return an object with updated `globalVx` and `globalVy` values.
    - `debug`: Enable debug mode for performance logging (default: false).

4. The sand animation will automatically respond to mouse or touch input, repelling the sand particles within the specified repelRadius.

## Performance Considerations

Keep the grain count less than 20,000 for optimal performance. This can be achieved by editing the image ahead of time to have as much white space as possible and clear constrast between objects in the image.
Use the debug option during development to monitor the animation's performance and frames per second (FPS).

## Contributing
Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request on the GitHub repository.

## License
This library is released under the MIT License.