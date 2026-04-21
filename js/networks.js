const AD_NETWORKS = {
  "Google AdMob": [
    { w: 320,  h: 50,   name: "Banner" },
    { w: 320,  h: 100,  name: "Large Banner" },
    { w: 300,  h: 250,  name: "MREC" },
    { w: 468,  h: 60,   name: "Full Banner" },
    { w: 728,  h: 90,   name: "Leaderboard" },
    { w: 1080, h: 1920, name: "Interstitial Portrait" },
    { w: 1920, h: 1080, name: "Interstitial Landscape" }
  ],
  "Meta": [
    { w: 1080, h: 1080, name: "Feed Square" },
    { w: 1080, h: 1350, name: "Feed 4:5" },
    { w: 1200, h: 628,  name: "Feed Landscape" },
    { w: 1080, h: 1920, name: "Stories / Reels",
      safeZones: [
        { x: 0, y: 0,    w: 1080, h: 250,  label: "Top UI" },
        { x: 0, y: 1580, w: 1080, h: 340,  label: "Bottom UI" }
      ]
    }
  ],
  "Unity": [
    { w: 1080, h: 1920, name: "Portrait",
      safeZones: [{ x: 900, y: 30, w: 160, h: 160, label: "Skip" }]
    },
    { w: 1920, h: 1080, name: "Landscape",
      safeZones: [{ x: 1740, y: 30, w: 160, h: 160, label: "Skip" }]
    },
    { w: 480,  h: 480,  name: "Square" },
    { w: 320,  h: 480,  name: "Banner Portrait" },
    { w: 480,  h: 320,  name: "Banner Landscape" },
    { w: 300,  h: 250,  name: "MREC" }
  ],
  "IronSource": [
    { w: 1080, h: 1920, name: "Portrait Fullscreen",
      safeZones: [{ x: 900, y: 30, w: 160, h: 160, label: "Close" }]
    },
    { w: 1920, h: 1080, name: "Landscape Fullscreen",
      safeZones: [{ x: 1740, y: 30, w: 160, h: 160, label: "Close" }]
    },
    { w: 720,  h: 1280, name: "Portrait HD" },
    { w: 1280, h: 720,  name: "Landscape HD" },
    { w: 320,  h: 50,   name: "Banner" },
    { w: 728,  h: 90,   name: "Tablet Banner" },
    { w: 300,  h: 250,  name: "MREC" }
  ],
  "AppLovin": [
    { w: 1080, h: 1920, name: "Portrait",
      safeZones: [{ x: 900, y: 30, w: 160, h: 160, label: "Close" }]
    },
    { w: 1920, h: 1080, name: "Landscape",
      safeZones: [{ x: 1740, y: 30, w: 160, h: 160, label: "Close" }]
    },
    { w: 320,  h: 50,   name: "Banner" },
    { w: 728,  h: 90,   name: "Tablet Banner" },
    { w: 300,  h: 250,  name: "MREC" }
  ],
  "Moloco": [
    { w: 1080, h: 1920, name: "Portrait" },
    { w: 1920, h: 1080, name: "Landscape" },
    { w: 300,  h: 250,  name: "MREC" },
    { w: 320,  h: 480,  name: "Vertical Banner" }
  ],
  "Mintegral": [
    { w: 1080, h: 1920, name: "Portrait" },
    { w: 1920, h: 1080, name: "Landscape" },
    { w: 720,  h: 1280, name: "Portrait HD" },
    { w: 1280, h: 720,  name: "Landscape HD" },
    { w: 600,  h: 600,  name: "Square" },
    { w: 480,  h: 480,  name: "Square Small" },
    { w: 320,  h: 50,   name: "Banner" }
  ]
};
