# Mouse Gesture Extension

A powerful browser extension for **Chrome**, **Edge**, and **Firefox** that enhances browsing efficiency through mouse gestures, super drag, intelligent tab management, link preview, and settings in a popup or side panel.

## Features

### Mouse Gestures
Hold right mouse button and drag to perform gestures. Our smart recognition algorithm ensures accurate gesture detection even with imperfect drawing.

#### Built-in Gestures
| Gesture | Action | Description |
|---------|--------|-------------|
| Left | Back | Navigate to previous page |
| Right | Forward | Navigate to next page |
| Up | Scroll Up | Scroll page upward |
| Down | Scroll Down | Scroll page downward |
| Down then Right | Close Tab | Close current tab |
| Left then Up | Reopen Tab | Reopen last closed tab |
| Right then Up | New Tab | Open new tab |
| Right then Down | Refresh | Reload current page |
| Up then Left | Previous Tab | Switch to left tab |
| Up then Right | Next Tab | Switch to right tab |
| Down then Left | Stop Loading | Stop page loading |
| Left then Down | Force Refresh  | Force reload current page (bypasses cache) |
| Up then Down | Scroll to Bottom | Scroll to page bottom |
| Down then Up | Scroll to Top | Scroll to page top |
| Left then Right | Close Tab | Alternative way to close tab |
| Right then Left | Reopen Tab | Alternative way to reopen tab |

### Popup View
Quickly preview links and search content with modifier keys without leaving your current page:

- **Real-time link previews**: Hold trigger key (default: Shift) while hovering over links to preview target pages in popup windows
- **Text selection search**: Select text and press the trigger key to instantly search the selected content
- **Highly customizable**:
  - Choose trigger keys (Control, Alt, Shift, or no key)
  - Adjust hover delay (100-5000ms, default: 200ms)
  - Set maximum preview windows (1-10)
  - Customize window dimensions
  - Configure window positioning (cursor position, screen center, or corner)
  - Customize search engine (supports Google, Baidu, Bing, etc. using {q} placeholder)
- **Multi-window support**: Open multiple preview windows simultaneously for increased information gathering efficiency
- **Smart window positioning**: Intelligently adjusts window position based on screen boundaries to ensure full visibility
- **Clean interface**: Distraction-free preview windows for optimal browsing experience

### Debug Panel
Open the debug panel anytime with the shortcut `Alt+D` to analyze and troubleshoot gesture recognition:

- **Real-time gesture information**: View original direction sequences, merged directions, similarity scores, and more
- **Persistent state**: Panel state automatically maintained after page refresh or navigation
- **One-click copy feature**: Easily copy debug information for analysis or sharing
- **Multi-language support**: Automatically switches between English and Chinese based on system settings
- **Modern interface**: Stylish color scheme and layout with intuitive direction indicators
- **Easy to use**: Press `Alt+D` to toggle, no additional settings required

### Super Drag
Enhance your drag operations with smart actions:
- Drag links to open in new tabs
- Drag images to view in new tabs
- Drag selected text to search
- Customize the drag direction to determine the tab opening method: open in the background by default

### Intelligent Tab Management
Never lose track of your tabs with our advanced management features:

#### Duplicate Tab Detection
- Smart detection that compares URLs accurately, ignoring variations in URL formats
- Interactive notification with options to close duplicates or ignore
- Toggle feature on/off in settings
- Prevents browser clutter and improves performance

#### Auto-Close Duplicate Tabs
- Automatically closes duplicate tabs when new ones are opened (optional)
- Success notification with titles of closed tabs
- Intelligent URL normalization for accurate matching
- User-controlled with a simple toggle in settings

#### Tabs Memory Optimization
- Periodic cleanup of unused tab data
- Improved browser performance by reducing memory usage
- Intelligent frequency-based data retention

### Enhanced Visual Interface

#### Gesture Hints
- Beautiful semi-transparent UI with refined borders
- Intelligent context-based icons and colors
- Adaptive themes based on page background
- Smooth animations and transitions

#### Image & Video Preview
- Enhanced image preview on hover
- Optimized video poster images with adaptive backgrounds
- Cross-origin media support with intelligent degradation
- Rounded corners support for circular and custom-shaped media

### Additional Features
- 🎨 Customizable gesture trails (color and width)
- 🌙 Dark/Light theme support
- 🌐 Multilingual interface (29 languages supported)
- 🖼️ Image preview on hover
- ⚡ Works during page load
- 🎯 Smart gesture recognition with fault tolerance
- 🔗 Intelligent URL handling for all protocols
- 🔄 Optimized welcome page and extension resources
- 📋 Built-in debug panel, quickly accessible with Alt+D
- 🌎 Wildcard pattern matching system supports more video websites

### Supported Languages
This extension supports 29 languages with localized search engines:
- 🇺🇸 **English** - DuckDuckGo
- 🇨🇳 **简体中文** - 百度搜索
- 🇹🇼 **繁體中文** - Google 台灣
- 🇪🇸 **Español** - Google España
- 🇫🇷 **Français** - Qwant
- 🇩🇪 **Deutsch** - Startpage
- 🇷🇺 **Русский** - Яндекс
- 🇯🇵 **日本語** - Yahoo Japan
- 🇰🇷 **한국어** - Naver
- 🇮🇳 **हिंदी** - Google India
- 🇧🇷 **Português** - Google Brasil
- 🇸🇦 **العربية** - Google Arabic
- 🇧🇩 **বাংলা** - Google Bangladesh
- 🇳🇱 **Nederlands** - Google Nederland
- 🇹🇷 **Türkçe** - Google Türkiye
- 🇺🇦 **Українська** - Google Ukraine
- 🇵🇰 **اردو** - Google Pakistan
- 🇮🇩 **Bahasa Indonesia** - Google Indonesia
- 🇮🇹 **Italiano** - Google Italia
- 🇵🇱 **Polski** - Google Polska
- 🇰🇪 **Kiswahili** - Google Kenya
- 🇹🇭 **ไทย** - Google Thailand
- 🇻🇳 **Tiếng Việt** - Google Vietnam
- 🇨🇿 **Čeština** - Google Česko
- 🇩🇰 **Dansk** - Google Danmark
- 🇸🇰 **Slovensky** - Google Slovenština
- 🇳🇴 **Norsk** - Google Norge
- 🇫🇮 **Suomen** - Google Suomi
- 🇪🇪 **Eesti** - Google Eesti

## Installation

### From Chrome Web Store
1. Visit [Chrome Web Store](https://chrome.google.com/webstore)
2. Search for "Mouse Gesture Extension"
3. Click "Add to Chrome"

### Manual Installation (Developer Mode)
1. Download and extract this repository
2. Open Chrome/Edge and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the extracted folder

## Usage

### Basic Usage
1. Install the extension
2. Hold right mouse button and drag to perform gestures
3. Visual trails will guide your gestures
4. Release right button to execute the action
5. On Linux and macOS systems, double right-click to show browser context menu

### Popup View Usage
1. Hover your mouse over any link
2. Press and hold the trigger key (default: Shift key)
3. After a brief delay, the popup window will automatically open
4. You can also select text and press the trigger key to search the selected content

### Debug Feature Usage
1. Press `Alt+D` on any page to open the debug panel
2. Perform mouse gestures to see real-time recognition analysis
3. Click the "📋" button in the panel's top-right to copy debug information
4. Press `Alt+D` again or click the "×" button to close the panel

### Customization
Click the extension icon to access settings:
- Enable/disable mouse gestures
- Enable/disable gesture trails
- Customize trail color
- Adjust trail width
- Toggle super drag feature
- Enable/disable duplicate tab detection
- Enable/disable auto-close duplicate tabs
- Enable/disable popup view feature
- Configure popup view modifier key, delay time, etc.
- Switch language
- Change theme

## Browser Compatibility
- Chrome 88+
- Edge 88+ (Chromium-based)

## Privacy
### Data Collection and Storage
- No personal data collection
- No browsing history tracking
- No user behavior monitoring
- All settings are stored locally in your browser
- No data is transmitted to external servers

### Permissions Usage
- `tabs`: Used only for gesture-based tab operations (switching, closing, etc.)
- `storage`: Used only for saving your preferences locally
- `sessions`: Used only for restoring recently closed tabs
- `activeTab`: Used to enable gesture detection and processing in the active tab only when user interacts
- `scripting`: Used to inject necessary content scripts for gesture recognition and visual feedback
- `<all_urls>`: Required for gesture functionality, but no page content is collected or transmitted

### Security
- No external dependencies or third-party services
- No remote code execution
- No analytics or tracking scripts
- All code is open source and can be audited
- Updates only through official Chrome Web Store

### Data Protection
- Settings are synced through your Chrome account (if enabled)
- No cookies or local storage beyond extension settings
- No access to sensitive page content
- No clipboard access without explicit user action
- No background processes except for gesture detection

For more details about our privacy practices, visit: https://abcrk.com/420.html

## Technical Details
- Built with Manifest V3
- Uses modern browser APIs
- Optimized performance
- Minimal resource usage
- Smart URL handling for all protocols
- Defensive programming techniques

## Recent Updates
- Expanded language support from 13 to 29 languages, with new additions including Dutch, Turkish, Ukrainian, Urdu, Indonesian, Italian, Polish, Swahili, Thai, Vietnamese, Czech, Danish, Swedish, Norwegian, Finnish, and Estonian
- Completely updated and refined translations for Turkish, Urdu, Dutch, and Ukrainian languages
- Improved the debug panel translations across all languages for better user experience
- Added wildcard pattern matching to support more video sites including YouTube, Bilibili, Netflix, Twitch, and more
- On Linux and macOS systems, double right-click to show browser context menu
- Improved scroll gestures to work properly on video websites like YouTube, Douyin, iQIYI etc.
- Fixed issue with numeric formats like 8.8, 8.8.8 being misidentified as IP addresses during drag operations
- Enhanced drag functionality to prioritize selected text even when text is on a link
- Extension functionality now works immediately on all open tabs upon installation, no refresh needed
- Fixed text drag search functionality on Linux and macOS systems
- Fixed issue with Drag Text Search toggle not working properly when disabled
- Optimized popup view hover delay from 300ms to 200ms for faster preview response
- Added popup view feature with key triggers and customizable search engines
- Enhanced text selection search with multiple search engine configuration
- Added debug panel feature with Alt+D shortcut, one-click copy and bilingual support
- Added auto-close duplicate tabs feature with success notifications
- Improved memory management with periodic cleanup
- Enhanced gesture hint UI with semi-transparent borders and refined aesthetics
- Optimized video poster image handling to eliminate black borders
- Improved cross-origin media handling with adaptive backgrounds
- Added smart URL normalization for better duplicate detection
- Enhanced user control over notification interactions
- Fixed Canvas operations issues with cross-origin content

## Development

### Project Structure
```
├── manifest.json
├── background.js
├── content.js
├── preview.js
├── popup.html
├── popup.css
├── popup.js
├── welcome.html
├── welcome.js
├── _locales/
│   ├── en_US/
│   │   └── messages.json
│   ├── zh_CN/
│   │   └── messages.json
│   ├── zh_TW/
│   │   └── messages.json
│   ├── es/
│   │   └── messages.json
│   ├── fr/
│   │   └── messages.json
│   ├── de/
│   │   └── messages.json
│   ├── ru/
│   │   └── messages.json
│   ├── ja/
│   │   └── messages.json
│   ├── ko/
│   │   └── messages.json
│   ├── hi/
│   │   └── messages.json
│   ├── pt/
│   │   └── messages.json
│   ├── ar/
│   │   └── messages.json
│   ├── bn/
│   │   └── messages.json
│   ├── nl/
│   │   └── messages.json
│   ├── tr/
│   │   └── messages.json
│   ├── uk/
│   │   └── messages.json
│   ├── ur/
│   │   └── messages.json
│   ├── id/
│   │   └── messages.json
│   ├── it/
│   │   └── messages.json
│   ├── pl/
│   │   └── messages.json
│   ├── sw/
│   │   └── messages.json
│   ├── th/
│   │   └── messages.json
│   └── vi/
│       └── messages.json
└── images/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Building from Source
1. Clone the repository
2. Make your modifications
3. Test in Chrome/Edge with developer mode
4. Package for distribution

## Contributing
Contributions are welcome! Please feel free to submit pull requests.

## License Information

This project is available under a **dual licensing model**:

### 🆓 GNU General Public License v3 (GPL v3) - Free for Open Source Use

**Available for:** Personal, educational, and open-source projects

- ✅ **Free to use** for personal and open-source projects
- ✅ **Free to modify** and distribute
- ✅ **Free to study** and learn from the source code
- ⚠️ **Copyleft requirement:** Any derivative works must also be licensed under GPL v3
- ⚠️ **Source code disclosure:** Must provide source code when distributing

**Best for:**
- Open-source projects
- Educational use
- Personal projects
- Non-commercial applications

### 💼 Commercial License - For Proprietary and Commercial Use

**Available for:** Commercial software, proprietary applications, and enterprise solutions

- ✅ **Use in proprietary software** without GPL requirements
- ✅ **Distribute without source code** disclosure
- ✅ **Modify without copyleft** obligations
- ✅ **Integrate into commercial products**
- ✅ **Sublicense to end users** under proprietary terms

**Best for:**
- Commercial software
- Proprietary applications
- Closed-source projects
- Enterprise solutions

### License Selection Guide

| Use Case | Recommended License |
|----------|-------------------|
| Open-source project | GPL v3 (Free) |
| Personal use | GPL v3 (Free) |
| Educational use | GPL v3 (Free) |
| Commercial software | Commercial License |
| Proprietary application | Commercial License |
| Enterprise solution | Commercial License |

### License Files

- [`LICENSE`](LICENSE) - Full GPL v3 license text
- [`COMMERCIAL_LICENSE.md`](COMMERCIAL_LICENSE.md) - Commercial license terms
- [`LICENSE_INFO.md`](LICENSE_INFO.md) - Detailed overview
- [`README_LICENSE.md`](README_LICENSE.md) - Quick reference

### Contact Information

**For commercial licensing inquiries:**
- **Email:** license@cgqa.com
- **Author:** CGQA
- **Project:** Mouse Gesture Extension

**Copyright:** 2025-2026 CGQA <license@cgqa.com>

---

*Choose the license that best fits your intended use case.*

## Support
If you encounter any issues or have suggestions, please visit: https://abcrk.com/420.html

## Acknowledgments
Thanks to all contributors and users who help improve this extension! 