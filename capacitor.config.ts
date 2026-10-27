import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.galawaydude.chesscoach',
  appName: 'Chess Coach',
  webDir: 'dist',
  backgroundColor: '#2f6f6f',
  plugins: {
    SystemBars: { style: 'DARK', insetsHandling: 'css' },
  },
}

export default config
