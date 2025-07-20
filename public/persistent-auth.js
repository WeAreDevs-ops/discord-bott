
// Persistent Authentication Handler
class PersistentAuth {
    constructor() {
        this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
        this.extendThreshold = 7 * 24 * 60 * 60 * 1000; // Extend if less than 7 days remaining
        
        this.init();
    }
    
    async init() {
        // Check authentication status on page load
        await this.checkAuthStatus();
        
        // Set up periodic checks
        setInterval(() => this.checkAuthStatus(), this.checkInterval);
        
        // Extend session on user activity
        this.setupActivityListeners();
    }
    
    async checkAuthStatus() {
        try {
            const response = await fetch('/api/session/check', {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.authenticated) {
                this.handleAuthenticatedUser(data);
                
                // Check if session needs extension
                const timeUntilExpiry = data.expiresAt - Date.now();
                if (timeUntilExpiry < this.extendThreshold) {
                    await this.extendSession();
                }
            } else {
                this.handleUnauthenticatedUser();
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }
    
    async extendSession() {
        try {
            const response = await fetch('/api/session/extend', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                console.log('Session extended successfully');
            }
        } catch (error) {
            console.error('Error extending session:', error);
        }
    }
    
    handleAuthenticatedUser(data) {
        // Update UI to show authenticated state
        const loginButtons = document.querySelectorAll('.login-btn');
        const userInfo = document.querySelectorAll('.user-info');
        
        loginButtons.forEach(btn => {
            btn.style.display = 'none';
        });
        
        userInfo.forEach(info => {
            info.style.display = 'block';
            const avatar = info.querySelector('.user-avatar');
            const username = info.querySelector('.user-username');
            
            if (avatar && data.user.avatar) {
                avatar.src = `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=32`;
            }
            
            if (username) {
                username.textContent = data.user.username;
            }
        });
        
        // Show authenticated navigation
        const authNavigation = document.querySelectorAll('.auth-navigation');
        authNavigation.forEach(nav => {
            nav.style.display = 'block';
        });
    }
    
    handleUnauthenticatedUser() {
        // Update UI to show unauthenticated state
        const loginButtons = document.querySelectorAll('.login-btn');
        const userInfo = document.querySelectorAll('.user-info');
        const authNavigation = document.querySelectorAll('.auth-navigation');
        
        loginButtons.forEach(btn => {
            btn.style.display = 'block';
        });
        
        userInfo.forEach(info => {
            info.style.display = 'none';
        });
        
        authNavigation.forEach(nav => {
            nav.style.display = 'none';
        });
    }
    
    setupActivityListeners() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        let lastActivity = Date.now();
        
        const updateActivity = () => {
            const now = Date.now();
            if (now - lastActivity > 60000) { // Only update if more than 1 minute passed
                lastActivity = now;
                this.extendSession();
            }
        };
        
        events.forEach(event => {
            document.addEventListener(event, updateActivity, true);
        });
    }
    
    logout() {
        window.location.href = '/auth/logout';
    }
}

// Initialize persistent auth when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.persistentAuth = new PersistentAuth();
});

// Export for use in other scripts
window.PersistentAuth = PersistentAuth;
