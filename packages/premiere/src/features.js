/**
 * Atlas feature ids for the effects and transitions a tool can apply by name.
 * apply_effect applies any video effect by match name and any audio effect by
 * display name, so it performs each of these; add_transition likewise for the
 * video transitions.
 */

const fx = (names) => names.map((n) => `premiere.effects_transitions.effect_${n}`);

export const VIDEO_EFFECT_FEATURES = [
    ...fx([
        'alpha_adjust', 'alpha_glow', 'basic_3d', 'black_white', 'block_dissolve', 'brush_strokes', 'camera_blur',
        'cineon_converter', 'color_emboss', 'color_key', 'color_pass', 'color_replace', 'corner_pin', 'crop',
        'directional_blur', 'drop_shadow', 'echo', 'edge_feather', 'extract', 'find_edges', 'four_color_gradient',
        'gamma_correction', 'gaussian_blur', 'gradient_wipe', 'horizontal_flip', 'invert', 'lens_distortion',
        'lens_flare', 'levels', 'lighting_effects', 'lightning', 'linear_wipe', 'luma_key', 'magnify',
        'metadata_timecode_burnin', 'mirror', 'mosaic', 'noise', 'offset', 'posterize', 'posterize_time', 'procamp',
        'ramp', 'reduce_interlace_flicker', 'replicate', 'rolling_shutter_repair', 'roughen_edges', 'sdr_conform',
        'sharpen', 'simple_text', 'spherize', 'strobe_light', 'track_matte_key', 'transform', 'turbulent_displace',
        'twirl', 'ultra_key', 'unsharp_mask', 'vertical_flip', 'vr_effects', 'wave_warp',
    ]),
    'premiere.effects_transitions.warp_stabilizer',
    'premiere.effects_transitions.modern_effects',
    'premiere.color.lumetri_color_effect',
    'premiere.color.color_correction_effects',
    'premiere.ai_features.auto_reframe_clip',
];

export const AUDIO_EFFECT_FEATURES = [
    'adaptive_noise_reduction', 'amplify', 'analog_delay', 'automatic_click_remover', 'bandpass', 'bass', 'channel_mixer',
    'channel_volume', 'chorus_flanger', 'convolution_reverb', 'deesser', 'dehummer', 'delay', 'distortion', 'dynamics',
    'dynamics_processing', 'fft_filter', 'graphic_equalizer', 'hard_limiter', 'loudness_radar', 'multiband_compressor',
    'multitap_delay', 'parametric_equalizer', 'pitch_shifter', 'single_band_compressor', 'stereo_expander',
    'studio_reverb', 'tube_compressor', 'vocal_enhancer',
].map((n) => `premiere.audio.audio_effect_${n}`);

export const TRANSITION_FEATURES = [
    'additive_dissolve', 'cross_dissolve', 'dip_to_black', 'dip_to_white', 'film_dissolve', 'immersive', 'iris',
    'non_additive_dissolve', 'page_peel', 'slide', 'wipe', 'zoom',
].map((n) => `premiere.effects_transitions.transition_${n}`).concat(['premiere.effects_transitions.morph_cut']);
