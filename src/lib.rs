use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct Grain {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
}

#[wasm_bindgen]
pub struct Image {
    grains: Vec<Grain>,
    damping_factor: f32,
    width: f32,
    height: f32,
}

#[wasm_bindgen]
impl Image {
    /// Create a new image for the elevation data, initial grains, and other parameters
    pub fn new(grains: &[f32], damping_factor: f32, width: f32, height: f32) -> Self {
        let grains = grains
            .chunks(4)
            .map(|chunk| Grain {
                x: chunk[0],
                y: chunk[1],
                vx: chunk[2],
                vy: chunk[3],
            })
            .collect();

        Self {
            grains,
            damping_factor,
            width,
            height,
        }
    }

    pub fn next(&mut self) {
        for grain in self.grains.iter_mut() {
            grain.x += grain.vx;
            grain.y += grain.vy;

            if grain.x < 0.0 {
                grain.x *= -1.0;
                grain.vx *= -1.0;
            } else if grain.x > self.width {
                grain.x = self.width - (grain.x - self.width);
                grain.vx *= -1.0;
            }

            if grain.y < 0.0 {
                grain.y *= -1.0;
                grain.vy *= -1.0;
            } else if grain.y > self.height {
                grain.y = self.height - (grain.y - self.height);
                grain.vy *= -1.0;
            }

            grain.vx *= self.damping_factor;
            grain.vy *= self.damping_factor;
        }
    }

    pub fn grains(&self) -> js_sys::Float32Array {
        let grains: Vec<_> = self
            .grains
            .iter()
            .map(|grain| vec![grain.x, grain.y, grain.vx, grain.vy])
            .flatten()
            .collect();

        js_sys::Float32Array::from(grains.as_slice())
    }
}
