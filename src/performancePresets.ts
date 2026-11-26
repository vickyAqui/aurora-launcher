/**
 * Performance profiles shared by the launcher UI and the Electron main process.
 *
 * This module is deliberately pure: no Electron, no filesystem. The UI uses it to render the
 * profiles and the main process uses it to know what to write into the game files, so both sides
 * can never disagree about what a profile means.
 */

export type PerformanceProfileId = 'eco' | 'balanced' | 'quality'

export const PERFORMANCE_PROFILE_IDS: PerformanceProfileId[] = ['eco', 'balanced', 'quality']

/**
 * A value written into `options.txt`. Strings are quoted (Minecraft stores `renderClouds` that
 * way), numbers and booleans are written as-is.
 */
export type OptionValue = string | number | boolean

export interface IPerformanceProfile {
  id: PerformanceProfileId
  name: string
  tagline: string
  description: string
  icon: string
  /** Typical heap size for this profile, used when the hardware cannot be detected. */
  recommendedMemory: number
  /** Values merged into `options.txt`; every other line is left untouched. */
  options: Record<string, OptionValue>
  /** Nested patch for `config/embeddium-options.json`. */
  embeddium: Record<string, unknown>
  /** Nested patch for `config/sodium-extra-options.json`. */
  sodiumExtra: Record<string, unknown>
  /** Nested patch for `config/chloride-client.json`. */
  chloride: Record<string, unknown>
  /** Nested patch for `config/entityculling.json`. */
  entityCulling: Record<string, unknown>
  /** Nested patch for `config/betterfpsdist.json`. */
  betterFpsDist: Record<string, unknown>
  /** Nested patch for `config/cull-less-leaves.json`. */
  cullLessLeaves: Record<string, unknown>
  /** Nested patch for `config/alltheleaks.json`. */
  allTheLeaks: Record<string, unknown>
  /**
   * Whether Oculus should enable shaders. `auto` means "only when a shader pack is already
   * selected", so the quality profile never turns on an empty shader pipeline.
   */
  oculusShaders: boolean | 'auto'
  /** `mode` inside `config/sodiumdynamiclights-client.toml`. */
  dynamicLights: 'OFF' | 'SLOW' | 'FAST' | 'REALTIME'
  /** Short, player-facing bullet points for the profile card. */
  highlights: string[]
}

/**
 * Every profile writes only keys the mods already know. Unknown keys are preserved by the merge
 * functions in `electron/performance.ts`; the game and the mods keep ownership of everything else.
 */
export const PERFORMANCE_PROFILES: IPerformanceProfile[] = [
  {
    id: 'eco',
    name: 'Econômico',
    tagline: 'PC fraco · 8 GB',
    description: 'Corta o que mais pesa no frame sem tirar o essencial. Ideal para vídeo integrado ou 8 GB de RAM.',
    icon: 'fa-leaf',
    recommendedMemory: 4,
    options: {
      renderDistance: 6,
      simulationDistance: 5,
      graphicsMode: 0,
      particles: 2,
      ao: false,
      entityShadows: false,
      renderClouds: 'false',
      mipmapLevels: 0,
      biomeBlendRadius: 0,
      entityDistanceScaling: 0.5,
      maxFps: 90,
      enableVsync: false,
      prioritizeChunkUpdates: 0
    },
    embeddium: {
      quality: {
        weather_quality: 'FAST',
        leaves_quality: 'FAST',
        enable_vignette: false,
        use_quad_normals_for_shading: false
      },
      advanced: {
        use_advanced_staging_buffers: false,
        cpu_render_ahead_limit: 2
      },
      performance: {
        always_defer_chunk_updates_v2: true,
        animate_only_visible_textures: true,
        use_entity_culling: true,
        use_fog_occlusion: true,
        use_block_face_culling: true,
        use_compact_vertex_format: true,
        use_translucent_face_sorting_v2: true
      }
    },
    sodiumExtra: {
      animation_settings: {
        water: false,
        lava: false,
        fire: true,
        portal: false,
        block_animations: true,
        sculk_sensor: false
      },
      particle_settings: {
        rain_splash: false
      },
      detail_settings: {
        stars: false,
        rain_snow: false
      },
      render_settings: {
        item_frame: false,
        armor_stand: false,
        painting: false,
        piston: false,
        beacon_beam: false,
        enchanting_table_book: false,
        item_frame_name_tag: false,
        player_name_tag: false
      },
      extra_settings: {
        use_adaptive_sync: false,
        cloud_distance: 64
      }
    },
    chloride: {
      fastChests: true,
      fastBeds: true,
      rainParticles: false,
      rainDropParticles: false,
      entityDistanceCulling: true,
      tileEntityDistanceCulling: true
    },
    entityCulling: {
      tracingDistance: 64,
      captureRate: 10
    },
    betterFpsDist: {
      horizontalScaling: 0.75,
      verticalScaling: 2.0
    },
    cullLessLeaves: {
      depth: 1
    },
    allTheLeaks: {
      ingredientDedupe: false,
      resourceLocationDedupe: true
    },
    oculusShaders: false,
    dynamicLights: 'OFF',
    highlights: [
      'Render 6 chunks e simulação 5',
      'Partículas mínimas e sem nuvens',
      'Sem sombras de entidade',
      'Dynamic lights desligado',
      'Mipmap 0 e biome blend 0'
    ]
  },
  {
    id: 'balanced',
    name: 'Equilibrado',
    tagline: 'PC médio · 16 GB',
    description: 'O melhor custo-benefício: mantém o visual do pack e reduz o trabalho por frame.',
    icon: 'fa-scale-balanced',
    recommendedMemory: 6,
    options: {
      renderDistance: 10,
      simulationDistance: 8,
      graphicsMode: 0,
      particles: 1,
      ao: true,
      entityShadows: true,
      renderClouds: 'true',
      mipmapLevels: 2,
      biomeBlendRadius: 1,
      entityDistanceScaling: 0.75,
      maxFps: 120,
      enableVsync: false,
      prioritizeChunkUpdates: 1
    },
    embeddium: {
      quality: {
        weather_quality: 'DEFAULT',
        leaves_quality: 'DEFAULT',
        enable_vignette: false,
        use_quad_normals_for_shading: false
      },
      advanced: {
        use_advanced_staging_buffers: true,
        cpu_render_ahead_limit: 3
      },
      performance: {
        always_defer_chunk_updates_v2: true,
        animate_only_visible_textures: true,
        use_entity_culling: true,
        use_fog_occlusion: true,
        use_block_face_culling: true,
        use_compact_vertex_format: true,
        use_translucent_face_sorting_v2: true
      }
    },
    sodiumExtra: {
      animation_settings: {
        water: true,
        lava: true,
        fire: true,
        portal: true,
        block_animations: true,
        sculk_sensor: true
      },
      particle_settings: {
        rain_splash: true
      },
      detail_settings: {
        stars: true,
        rain_snow: true
      },
      render_settings: {
        item_frame: true,
        armor_stand: true,
        painting: true,
        piston: true,
        beacon_beam: true,
        enchanting_table_book: true,
        item_frame_name_tag: true,
        player_name_tag: true
      },
      extra_settings: {
        use_adaptive_sync: false,
        cloud_distance: 100
      }
    },
    chloride: {
      fastChests: true,
      fastBeds: true,
      rainParticles: true,
      rainDropParticles: true,
      entityDistanceCulling: true,
      tileEntityDistanceCulling: true
    },
    entityCulling: {
      tracingDistance: 96,
      captureRate: 5
    },
    betterFpsDist: {
      horizontalScaling: 1.0,
      verticalScaling: 2.0
    },
    cullLessLeaves: {
      depth: 2
    },
    allTheLeaks: {
      ingredientDedupe: false,
      resourceLocationDedupe: true
    },
    oculusShaders: false,
    dynamicLights: 'FAST',
    highlights: [
      'Render 10 chunks e simulação 8',
      'Partículas reduzidas',
      'Nuvens e sombras ligadas',
      'Mipmap 2 e biome blend 1',
      'Dynamic lights rápidas'
    ]
  },
  {
    id: 'quality',
    name: 'Qualidade',
    tagline: 'Visual completo',
    description: 'Mantém o pack no visual máximo. Use se o seu PC já roda bem e você quer os detalhes.',
    icon: 'fa-gem',
    recommendedMemory: 6,
    options: {
      renderDistance: 12,
      simulationDistance: 10,
      graphicsMode: 1,
      particles: 0,
      ao: true,
      entityShadows: true,
      renderClouds: 'true',
      mipmapLevels: 4,
      biomeBlendRadius: 2,
      entityDistanceScaling: 1.0,
      maxFps: 144,
      enableVsync: false,
      prioritizeChunkUpdates: 2
    },
    embeddium: {
      quality: {
        weather_quality: 'DEFAULT',
        leaves_quality: 'DEFAULT',
        enable_vignette: true,
        use_quad_normals_for_shading: false
      },
      advanced: {
        use_advanced_staging_buffers: true,
        cpu_render_ahead_limit: 3
      },
      performance: {
        always_defer_chunk_updates_v2: true,
        animate_only_visible_textures: true,
        use_entity_culling: true,
        use_fog_occlusion: true,
        use_block_face_culling: true,
        use_compact_vertex_format: true,
        use_translucent_face_sorting_v2: true
      }
    },
    sodiumExtra: {
      animation_settings: {
        water: true,
        lava: true,
        fire: true,
        portal: true,
        block_animations: true,
        sculk_sensor: true
      },
      particle_settings: {
        rain_splash: true
      },
      detail_settings: {
        stars: true,
        rain_snow: true
      },
      render_settings: {
        item_frame: true,
        armor_stand: true,
        painting: true,
        piston: true,
        beacon_beam: true,
        enchanting_table_book: true,
        item_frame_name_tag: true,
        player_name_tag: true
      },
      extra_settings: {
        use_adaptive_sync: false,
        cloud_distance: 128
      }
    },
    chloride: {
      fastChests: false,
      fastBeds: false,
      rainParticles: true,
      rainDropParticles: true,
      entityDistanceCulling: true,
      tileEntityDistanceCulling: true
    },
    entityCulling: {
      tracingDistance: 128,
      captureRate: 5
    },
    betterFpsDist: {
      horizontalScaling: 1.1,
      verticalScaling: 2.0
    },
    cullLessLeaves: {
      depth: 2
    },
    allTheLeaks: {
      ingredientDedupe: false,
      resourceLocationDedupe: true
    },
    oculusShaders: 'auto',
    dynamicLights: 'REALTIME',
    highlights: [
      'Render 12 chunks e simulação 10',
      'Gráficos fancy e todas as partículas',
      'Mipmap 4 e biome blend 2',
      'Shaders se houver pack escolhido',
      'Dynamic lights em tempo real'
    ]
  }
]

export function isPerformanceProfileId(value: unknown): value is PerformanceProfileId {
  return typeof value === 'string' && PERFORMANCE_PROFILE_IDS.includes(value as PerformanceProfileId)
}

export function getPerformanceProfile(id: PerformanceProfileId): IPerformanceProfile {
  const profile = PERFORMANCE_PROFILES.find((entry) => entry.id === id)
  // The array above is the only source of ids, so this can only happen if the two drift apart.
  if (!profile) throw new Error(`Unknown performance profile: ${id}`)
  return profile
}

/**
 * Heap size suggested for the machine, in GB.
 *
 * The launcher used to open with 1–4 GB, which is too little for this pack. The table follows the
 * values the pack's own `memorysettings.json` recommends, but never goes above half of the
 * physical RAM: the game, the JVM and the OS all need memory outside the heap.
 */
export function suggestMemoryGB(totalMemGB: number): number {
  if (!Number.isFinite(totalMemGB) || totalMemGB <= 0) return 4

  // Alinhado ao `recommendedMemory` de config/memorysettings.json do modpack,
  // arredondado para GB inteiros. A antiga tabela chegava a 8 GB em qualquer
  // máquina com mais de 24 GB, enquanto o pack recomenda 5-7 GB nessa faixa.
  const table: Array<[number, number]> = [
    [4, 2],
    [6, 3],
    [8, 4],
    [12, 5],
    [16, 7],
    [24, 8],
    [32, 9],
    [64, 10],
    [Number.POSITIVE_INFINITY, 10]
  ]

  const recommended = table.find(([limit]) => totalMemGB <= limit)?.[1] ?? 8
  const half = Math.max(1, Math.floor(totalMemGB / 2))
  return Math.max(1, Math.min(recommended, half))
}

/**
 * JVM flags applied on top of the heap size chosen by the launcher.
 *
 * This is the Aikar/G1 set without `-Xmx`/`-Xms`: `eml-lib` already writes those from the memory
 * setting, and a duplicate `-Xmx` is exactly the kind of mistake that stops the game from opening.
 * The heavier flags are only used when there is enough memory to pay for them.
 */
export function buildJvmArgs(profileId: PerformanceProfileId, memoryGB: number): string[] {
  const args = [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true'
  ]

  // `AlwaysPreTouch` reserves the whole heap at startup: great on 16 GB, a slow and memory-hungry
  // start on a weak machine. String deduplication only pays off once the heap is not tiny.
  if (profileId !== 'eco') {
    args.push('-XX:+AlwaysPreTouch')
    if (memoryGB >= 6) args.push('-XX:+UseStringDeduplication')
  }

  return args
}
