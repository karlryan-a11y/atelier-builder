// Learned look-layout rules — median item placements (% of board) mined from 4000 GoodPix
// look images via Claude Vision (scripts/full-layouts). Consumed by the compose/Style engine when
// the learned-layout flag is on. Positions are the item CENTER as a % of board width/height; size
// is the item height as a % of board height. Regenerate by re-running the analysis + pasting here.
export interface CatPos { x: number; y: number; size: number }
export interface LayoutRules {
  generated_at: string
  sample_size: number
  global: Record<string, CatPos>
  archetypes: Record<string, { count: number; cats: Record<string, CatPos> }>
  multiples: Record<string, Record<string, number[]>>
}

export const LAYOUT_RULES: LayoutRules = {
  "generated_at": "2026-07-02T17:30:44.688Z",
  "sample_size": 4000,
  "global": {
    "outerwear": {
      "x": 25,
      "y": 20,
      "size": 35
    },
    "top": {
      "x": 50,
      "y": 25,
      "size": 25
    },
    "bottom": {
      "x": 50,
      "y": 55,
      "size": 45
    },
    "belt": {
      "x": 55,
      "y": 38,
      "size": 8
    },
    "shoes": {
      "x": 40,
      "y": 85,
      "size": 12
    },
    "jewelry": {
      "x": 80,
      "y": 15,
      "size": 8
    },
    "dress": {
      "x": 50,
      "y": 45,
      "size": 60
    },
    "scarf": {
      "x": 75,
      "y": 20,
      "size": 20
    },
    "bag": {
      "x": 75,
      "y": 35,
      "size": 20
    },
    "accessory": {
      "x": 75,
      "y": 30,
      "size": 12
    },
    "hat": {
      "x": 55,
      "y": 10,
      "size": 8
    },
    "tights": {
      "x": 20,
      "y": 55,
      "size": 48
    },
    "necklace": {
      "x": 75,
      "y": 15,
      "size": 8
    }
  },
  "archetypes": {
    "belt+bottom+outerwear+shoes+top": {
      "count": 182,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 25,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "belt": {
          "x": 65,
          "y": 38,
          "size": 8
        },
        "shoes": {
          "x": 45,
          "y": 88,
          "size": 12
        }
      }
    },
    "bottom+shoes+top": {
      "count": 401,
      "cats": {
        "top": {
          "x": 35,
          "y": 20,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "shoes": {
          "x": 35,
          "y": 88,
          "size": 12
        }
      }
    },
    "bottom+outerwear+shoes+top": {
      "count": 1107,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 28,
          "size": 25
        },
        "bottom": {
          "x": 55,
          "y": 55,
          "size": 45
        },
        "shoes": {
          "x": 40,
          "y": 88,
          "size": 12
        }
      }
    },
    "belt+bottom+jewelry+outerwear+shoes+top": {
      "count": 124,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 25,
          "size": 20
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "belt": {
          "x": 50,
          "y": 42,
          "size": 8
        },
        "shoes": {
          "x": 50,
          "y": 88,
          "size": 12
        },
        "jewelry": {
          "x": 80,
          "y": 15,
          "size": 8
        }
      }
    },
    "belt+bottom+shoes+top": {
      "count": 75,
      "cats": {
        "top": {
          "x": 35,
          "y": 20,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 50
        },
        "shoes": {
          "x": 45,
          "y": 85,
          "size": 12
        },
        "belt": {
          "x": 75,
          "y": 30,
          "size": 8
        }
      }
    },
    "bottom+jewelry+shoes+top": {
      "count": 178,
      "cats": {
        "top": {
          "x": 35,
          "y": 20,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 12
        },
        "jewelry": {
          "x": 80,
          "y": 15,
          "size": 8
        }
      }
    },
    "dress+outerwear+shoes": {
      "count": 158,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "dress": {
          "x": 55,
          "y": 48,
          "size": 60
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 12
        }
      }
    },
    "belt+dress+outerwear+shoes": {
      "count": 13,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "dress": {
          "x": 50,
          "y": 50,
          "size": 65
        },
        "belt": {
          "x": 75,
          "y": 32,
          "size": 8
        },
        "shoes": {
          "x": 60,
          "y": 85,
          "size": 12
        }
      }
    },
    "bottom+jewelry+outerwear+shoes+top": {
      "count": 545,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 28,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "shoes": {
          "x": 40,
          "y": 85,
          "size": 12
        },
        "jewelry": {
          "x": 80,
          "y": 15,
          "size": 8
        }
      }
    },
    "bottom+outerwear+scarf+shoes+top": {
      "count": 14,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 27,
          "size": 25
        },
        "scarf": {
          "x": 75,
          "y": 20,
          "size": 20
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "shoes": {
          "x": 55,
          "y": 88,
          "size": 15
        }
      }
    },
    "dress+jewelry+shoes": {
      "count": 34,
      "cats": {
        "dress": {
          "x": 50,
          "y": 45,
          "size": 65
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 12
        },
        "jewelry": {
          "x": 82,
          "y": 18,
          "size": 8
        }
      }
    },
    "belt+bottom+jewelry+shoes+top": {
      "count": 42,
      "cats": {
        "top": {
          "x": 35,
          "y": 21,
          "size": 25
        },
        "jewelry": {
          "x": 72,
          "y": 12,
          "size": 8
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "belt": {
          "x": 65,
          "y": 38,
          "size": 8
        },
        "shoes": {
          "x": 55,
          "y": 85,
          "size": 12
        }
      }
    },
    "bag+bottom+jewelry+outerwear+shoes+top": {
      "count": 98,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 25,
          "size": 20
        },
        "jewelry": {
          "x": 80,
          "y": 15,
          "size": 8
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "bag": {
          "x": 75,
          "y": 50,
          "size": 20
        },
        "shoes": {
          "x": 45,
          "y": 85,
          "size": 12
        }
      }
    },
    "bag+bottom+outerwear+shoes+top": {
      "count": 131,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 25,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "bag": {
          "x": 78,
          "y": 35,
          "size": 20
        },
        "shoes": {
          "x": 45,
          "y": 85,
          "size": 12
        }
      }
    },
    "bag+dress+outerwear+shoes": {
      "count": 28,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "dress": {
          "x": 55,
          "y": 45,
          "size": 60
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 12
        },
        "bag": {
          "x": 75,
          "y": 50,
          "size": 20
        }
      }
    },
    "bag+belt+bottom+jewelry+outerwear+shoes+top": {
      "count": 31,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 25,
          "size": 20
        },
        "jewelry": {
          "x": 80,
          "y": 12,
          "size": 8
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "belt": {
          "x": 50,
          "y": 40,
          "size": 8
        },
        "bag": {
          "x": 75,
          "y": 50,
          "size": 20
        },
        "shoes": {
          "x": 40,
          "y": 88,
          "size": 12
        }
      }
    },
    "dress+jewelry+outerwear+shoes": {
      "count": 120,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 22,
          "size": 35
        },
        "dress": {
          "x": 50,
          "y": 45,
          "size": 55
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 12
        },
        "jewelry": {
          "x": 80,
          "y": 15,
          "size": 8
        }
      }
    },
    "accessory+bottom+jewelry+outerwear+shoes+top": {
      "count": 33,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 28,
          "size": 20
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 15
        },
        "jewelry": {
          "x": 80,
          "y": 15,
          "size": 8
        },
        "accessory": {
          "x": 78,
          "y": 30,
          "size": 12
        }
      }
    },
    "accessory+bottom+jewelry+shoes+top": {
      "count": 10,
      "cats": {
        "top": {
          "x": 35,
          "y": 23,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 50,
          "size": 43
        },
        "shoes": {
          "x": 50,
          "y": 83,
          "size": 14
        },
        "jewelry": {
          "x": 75,
          "y": 18,
          "size": 8
        },
        "accessory": {
          "x": 48,
          "y": 35,
          "size": 14
        }
      }
    },
    "accessory+bottom+outerwear+shoes+top": {
      "count": 62,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 30,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 40
        },
        "accessory": {
          "x": 73,
          "y": 35,
          "size": 11
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 14
        }
      }
    },
    "bottom+dress+jewelry+shoes+top": {
      "count": 6,
      "cats": {
        "dress": {
          "x": 50,
          "y": 43,
          "size": 53
        },
        "top": {
          "x": 35,
          "y": 20,
          "size": 18
        },
        "bottom": {
          "x": 50,
          "y": 50,
          "size": 20
        },
        "shoes": {
          "x": 43,
          "y": 85,
          "size": 12
        },
        "jewelry": {
          "x": 60,
          "y": 12,
          "size": 4
        }
      }
    },
    "dress+shoes": {
      "count": 57,
      "cats": {
        "dress": {
          "x": 50,
          "y": 45,
          "size": 65
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 12
        }
      }
    },
    "accessory+bottom+shoes+top": {
      "count": 38,
      "cats": {
        "top": {
          "x": 35,
          "y": 25,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 12
        },
        "accessory": {
          "x": 75,
          "y": 22,
          "size": 12
        }
      }
    },
    "accessory+belt+bottom+shoes+top": {
      "count": 7,
      "cats": {
        "top": {
          "x": 35,
          "y": 23,
          "size": 28
        },
        "bottom": {
          "x": 50,
          "y": 50,
          "size": 45
        },
        "belt": {
          "x": 50,
          "y": 38,
          "size": 8
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 12
        },
        "accessory": {
          "x": 75,
          "y": 18,
          "size": 10
        }
      }
    },
    "bag+bottom+jewelry+shoes+top": {
      "count": 43,
      "cats": {
        "top": {
          "x": 35,
          "y": 20,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 50,
          "size": 45
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 12
        },
        "bag": {
          "x": 75,
          "y": 43,
          "size": 20
        },
        "jewelry": {
          "x": 75,
          "y": 12,
          "size": 8
        }
      }
    },
    "accessory+bag+bottom+jewelry+outerwear+shoes+top": {
      "count": 8,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 29,
          "size": 21
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 40
        },
        "shoes": {
          "x": 33,
          "y": 85,
          "size": 15
        },
        "jewelry": {
          "x": 78,
          "y": 16,
          "size": 8
        },
        "bag": {
          "x": 75,
          "y": 43,
          "size": 22
        },
        "accessory": {
          "x": 63,
          "y": 38,
          "size": 9
        }
      }
    },
    "bag+dress+jewelry+shoes": {
      "count": 13,
      "cats": {
        "dress": {
          "x": 50,
          "y": 45,
          "size": 65
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 12
        },
        "jewelry": {
          "x": 80,
          "y": 15,
          "size": 8
        },
        "bag": {
          "x": 75,
          "y": 33,
          "size": 20
        }
      }
    },
    "accessory+belt+bottom+jewelry+outerwear+shoes+top": {
      "count": 8,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 28
        },
        "top": {
          "x": 50,
          "y": 25,
          "size": 20
        },
        "bottom": {
          "x": 50,
          "y": 53,
          "size": 35
        },
        "belt": {
          "x": 77,
          "y": 40,
          "size": 8
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 14
        },
        "jewelry": {
          "x": 78,
          "y": 14,
          "size": 10
        },
        "accessory": {
          "x": 75,
          "y": 39,
          "size": 8
        }
      }
    },
    "dress+jewelry+outerwear+shoes+top": {
      "count": 7,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 30
        },
        "top": {
          "x": 40,
          "y": 15,
          "size": 18
        },
        "dress": {
          "x": 50,
          "y": 50,
          "size": 50
        },
        "shoes": {
          "x": 35,
          "y": 85,
          "size": 15
        },
        "jewelry": {
          "x": 77,
          "y": 12,
          "size": 7
        }
      }
    },
    "dress+outerwear+shoes+top": {
      "count": 14,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 43,
          "y": 20,
          "size": 18
        },
        "dress": {
          "x": 55,
          "y": 50,
          "size": 55
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 12
        }
      }
    },
    "bottom+dress+jewelry+outerwear+shoes+top": {
      "count": 5,
      "cats": {
        "top": {
          "x": 50,
          "y": 20,
          "size": 18
        },
        "bottom": {
          "x": 34,
          "y": 48,
          "size": 35
        },
        "shoes": {
          "x": 40,
          "y": 88,
          "size": 12
        },
        "outerwear": {
          "x": 33,
          "y": 18,
          "size": 25
        },
        "jewelry": {
          "x": 85,
          "y": 18,
          "size": 8
        },
        "dress": {
          "x": 50,
          "y": 45,
          "size": 50
        }
      }
    },
    "accessory+belt+bottom+outerwear+shoes+top": {
      "count": 19,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 28,
          "size": 22
        },
        "bottom": {
          "x": 55,
          "y": 55,
          "size": 45
        },
        "belt": {
          "x": 77,
          "y": 38,
          "size": 8
        },
        "shoes": {
          "x": 45,
          "y": 85,
          "size": 12
        },
        "accessory": {
          "x": 80,
          "y": 25,
          "size": 10
        }
      }
    },
    "belt+dress+jewelry+shoes": {
      "count": 9,
      "cats": {
        "dress": {
          "x": 50,
          "y": 45,
          "size": 65
        },
        "belt": {
          "x": 63,
          "y": 28,
          "size": 8
        },
        "shoes": {
          "x": 50,
          "y": 84,
          "size": 12
        },
        "jewelry": {
          "x": 75,
          "y": 17,
          "size": 8
        }
      }
    },
    "bag+dress+jewelry+outerwear+shoes": {
      "count": 12,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "dress": {
          "x": 50,
          "y": 45,
          "size": 58
        },
        "bag": {
          "x": 75,
          "y": 54,
          "size": 19
        },
        "jewelry": {
          "x": 82,
          "y": 15,
          "size": 8
        },
        "shoes": {
          "x": 40,
          "y": 85,
          "size": 12
        }
      }
    },
    "accessory+dress+outerwear+shoes": {
      "count": 14,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "dress": {
          "x": 50,
          "y": 45,
          "size": 58
        },
        "shoes": {
          "x": 33,
          "y": 85,
          "size": 12
        },
        "accessory": {
          "x": 81,
          "y": 27,
          "size": 23
        }
      }
    },
    "accessory+bag+bottom+outerwear+shoes+top": {
      "count": 10,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 30
        },
        "top": {
          "x": 45,
          "y": 25,
          "size": 24
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 43
        },
        "shoes": {
          "x": 48,
          "y": 85,
          "size": 12
        },
        "bag": {
          "x": 80,
          "y": 30,
          "size": 18
        },
        "accessory": {
          "x": 75,
          "y": 45,
          "size": 8
        }
      }
    },
    "dress+shoes+top": {
      "count": 13,
      "cats": {
        "top": {
          "x": 30,
          "y": 20,
          "size": 25
        },
        "dress": {
          "x": 55,
          "y": 50,
          "size": 60
        },
        "shoes": {
          "x": 40,
          "y": 85,
          "size": 15
        }
      }
    },
    "bag+bottom+shoes+top": {
      "count": 73,
      "cats": {
        "top": {
          "x": 40,
          "y": 20,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 45
        },
        "bag": {
          "x": 75,
          "y": 32,
          "size": 20
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 12
        }
      }
    },
    "belt+dress+jewelry+outerwear+shoes": {
      "count": 7,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 23,
          "size": 35
        },
        "dress": {
          "x": 50,
          "y": 45,
          "size": 50
        },
        "belt": {
          "x": 50,
          "y": 35,
          "size": 8
        },
        "jewelry": {
          "x": 75,
          "y": 15,
          "size": 8
        },
        "shoes": {
          "x": 50,
          "y": 82,
          "size": 12
        }
      }
    },
    "bottom+dress+outerwear+shoes+top": {
      "count": 6,
      "cats": {
        "outerwear": {
          "x": 33,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 48,
          "y": 28,
          "size": 18
        },
        "bottom": {
          "x": 53,
          "y": 58,
          "size": 30
        },
        "dress": {
          "x": 50,
          "y": 42,
          "size": 29
        },
        "shoes": {
          "x": 43,
          "y": 88,
          "size": 12
        }
      }
    },
    "bag+dress+outerwear+shoes+top": {
      "count": 5,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 15,
          "size": 25
        },
        "top": {
          "x": 35,
          "y": 18,
          "size": 15
        },
        "dress": {
          "x": 50,
          "y": 50,
          "size": 60
        },
        "bag": {
          "x": 80,
          "y": 35,
          "size": 20
        },
        "shoes": {
          "x": 32,
          "y": 88,
          "size": 12
        }
      }
    },
    "bag+belt+bottom+outerwear+shoes+top": {
      "count": 34,
      "cats": {
        "outerwear": {
          "x": 25,
          "y": 20,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 25,
          "size": 20
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 49
        },
        "shoes": {
          "x": 45,
          "y": 85,
          "size": 15
        },
        "bag": {
          "x": 78,
          "y": 34,
          "size": 22
        },
        "belt": {
          "x": 50,
          "y": 40,
          "size": 8
        }
      }
    },
    "bag+dress+shoes": {
      "count": 24,
      "cats": {
        "dress": {
          "x": 50,
          "y": 45,
          "size": 65
        },
        "bag": {
          "x": 75,
          "y": 25,
          "size": 20
        },
        "shoes": {
          "x": 40,
          "y": 85,
          "size": 12
        }
      }
    },
    "accessory+dress+shoes": {
      "count": 11,
      "cats": {
        "dress": {
          "x": 50,
          "y": 45,
          "size": 65
        },
        "shoes": {
          "x": 28,
          "y": 84,
          "size": 15
        },
        "accessory": {
          "x": 75,
          "y": 25,
          "size": 15
        }
      }
    },
    "accessory+bag+bottom+shoes+top": {
      "count": 7,
      "cats": {
        "top": {
          "x": 45,
          "y": 20,
          "size": 20
        },
        "bottom": {
          "x": 45,
          "y": 50,
          "size": 45
        },
        "accessory": {
          "x": 78,
          "y": 28,
          "size": 14
        },
        "bag": {
          "x": 75,
          "y": 28,
          "size": 22
        },
        "shoes": {
          "x": 50,
          "y": 85,
          "size": 15
        }
      }
    },
    "belt+dress+shoes": {
      "count": 11,
      "cats": {
        "dress": {
          "x": 50,
          "y": 45,
          "size": 70
        },
        "belt": {
          "x": 75,
          "y": 25,
          "size": 8
        },
        "shoes": {
          "x": 60,
          "y": 85,
          "size": 12
        }
      }
    },
    "bag+belt+bottom+shoes+top": {
      "count": 7,
      "cats": {
        "top": {
          "x": 40,
          "y": 20,
          "size": 25
        },
        "bottom": {
          "x": 50,
          "y": 50,
          "size": 35
        },
        "belt": {
          "x": 50,
          "y": 42,
          "size": 8
        },
        "shoes": {
          "x": 43,
          "y": 85,
          "size": 12
        },
        "bag": {
          "x": 75,
          "y": 35,
          "size": 20
        }
      }
    },
    "bottom+jewelry+outerwear+scarf+shoes+top": {
      "count": 5,
      "cats": {
        "outerwear": {
          "x": 20,
          "y": 25,
          "size": 35
        },
        "top": {
          "x": 50,
          "y": 30,
          "size": 25
        },
        "scarf": {
          "x": 75,
          "y": 18,
          "size": 20
        },
        "bottom": {
          "x": 65,
          "y": 55,
          "size": 50
        },
        "shoes": {
          "x": 34,
          "y": 84,
          "size": 12
        },
        "jewelry": {
          "x": 85,
          "y": 20,
          "size": 8
        }
      }
    },
    "bottom+outerwear+shoes": {
      "count": 9,
      "cats": {
        "outerwear": {
          "x": 38,
          "y": 20,
          "size": 35
        },
        "bottom": {
          "x": 50,
          "y": 55,
          "size": 50
        },
        "shoes": {
          "x": 48,
          "y": 88,
          "size": 15
        }
      }
    }
  },
  "multiples": {
    "shoes": {
      "2": [
        25,
        70
      ],
      "3": [
        25,
        50,
        75
      ],
      "4": [
        25,
        35,
        70,
        80
      ],
      "5": [
        20,
        30,
        42,
        75,
        80
      ]
    },
    "belt": {
      "2": [
        50,
        75
      ]
    },
    "jewelry": {
      "2": [
        78,
        85
      ],
      "3": [
        75,
        80,
        85
      ],
      "4": [
        75,
        77,
        79,
        84
      ],
      "5": [
        40,
        45,
        63,
        89,
        89
      ]
    },
    "top": {
      "2": [
        35,
        55
      ],
      "3": [
        27,
        55,
        85
      ],
      "5": [
        20,
        25,
        50,
        75,
        83
      ]
    },
    "outerwear": {
      "2": [
        25,
        50
      ],
      "3": [
        15,
        50,
        80
      ]
    },
    "bottom": {
      "2": [
        40,
        75
      ],
      "3": [
        23,
        53,
        85
      ],
      "4": [
        28,
        29,
        83,
        84
      ]
    },
    "dress": {
      "2": [
        30,
        75
      ]
    },
    "bag": {
      "2": [
        25,
        80
      ],
      "3": [
        20,
        75,
        80
      ]
    },
    "accessory": {
      "2": [
        78,
        83
      ]
    }
  }
}
