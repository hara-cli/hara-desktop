use image::RgbaImage;

fn visible_bounds(image: &RgbaImage) -> (u32, u32, u32, u32) {
    let mut bounds = (image.width(), image.height(), 0, 0);
    for (x, y, pixel) in image.enumerate_pixels() {
        if pixel[3] >= 128 {
            bounds.0 = bounds.0.min(x);
            bounds.1 = bounds.1.min(y);
            bounds.2 = bounds.2.max(x);
            bounds.3 = bounds.3.max(y);
        }
    }
    bounds
}

fn assert_mac_safe_area(image: &RgbaImage) {
    assert_eq!(image.width(), image.height());
    let (left, top, right, bottom) = visible_bounds(image);
    let ratio = (right - left + 1) as f64 / image.width() as f64;
    assert!(
        (0.78..=0.83).contains(&ratio),
        "macOS visible-surface ratio {ratio}"
    );
    assert!((left as i32 - (image.width() - right - 1) as i32).abs() <= 2);
    assert!((top as i32 - (image.height() - bottom - 1) as i32).abs() <= 2);
    assert_eq!(image.get_pixel(0, 0)[3], 0);
}

#[test]
fn macos_brand_safe_area_does_not_shrink_other_platforms() {
    let generic = image::load_from_memory(include_bytes!("../../brand/hara-desktop-icon.png"))
        .unwrap()
        .to_rgba8();
    let macos = image::load_from_memory(include_bytes!("../../brand/hara-macos-icon.png"))
        .unwrap()
        .to_rgba8();
    assert_eq!(generic.dimensions(), (1024, 1024));
    assert_eq!(macos.dimensions(), (1024, 1024));
    let (left, _, right, _) = visible_bounds(&generic);
    assert!((980..=990).contains(&(right - left + 1)));
    assert_mac_safe_area(&macos);

    // Inspect the actual packaged ICNS frames, not just its source PNG or generator text.
    let icns = include_bytes!("../icons/icon.icns");
    assert_eq!(&icns[..4], b"icns");
    assert_eq!(
        u32::from_be_bytes(icns[4..8].try_into().unwrap()) as usize,
        icns.len()
    );
    let mut offset = 8;
    let mut frames = 0;
    while offset < icns.len() {
        let length = u32::from_be_bytes(icns[offset + 4..offset + 8].try_into().unwrap()) as usize;
        assert!(length >= 8 && offset + length <= icns.len());
        let payload = &icns[offset + 8..offset + length];
        if payload.starts_with(b"\x89PNG\r\n\x1a\n") {
            assert_mac_safe_area(&image::load_from_memory(payload).unwrap().to_rgba8());
            frames += 1;
        }
        offset += length;
    }
    assert!(frames >= 7, "verify small and Retina ICNS frames");
}
