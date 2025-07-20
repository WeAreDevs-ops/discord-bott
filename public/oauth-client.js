
// OAuth2 Client Utilities for Enhanced Discord Integration
class DiscordOAuth2Client {
    constructor() {
        this.baseURL = window.location.origin;
        this.checkTokenExpiry();
        
        // Set up automatic token refresh checking
        setInterval(() => this.checkTokenExpiry(), 60000); // Check every minute
    }
    
    // Check if token needs refresh based on server headers
    checkTokenExpiry() {
        const refreshRequired = document.querySelector('meta[name="token-refresh-required"]');
        if (refreshRequired && refreshRequired.content === 'true') {
            this.refreshToken();
        }
    }
    
    // Refresh access token
    async refreshToken() {
        try {
            const response = await fetch('/auth/refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Token refreshed successfully');
                
                // Update any UI indicators
                this.updateTokenStatus('refreshed');
                return true;
            } else {
                const error = await response.json();
                console.error('Token refresh failed:', error);
                
                // If refresh fails, redirect to re-authentication
                if (response.status === 401) {
                    this.reAuthenticate('admin');
                }
                return false;
            }
        } catch (error) {
            console.error('Token refresh error:', error);
            return false;
        }
    }
    
    // Re-authenticate with specific scopes
    reAuthenticate(scope = 'basic', guildId = null) {
        const params = new URLSearchParams({
            scope: scope,
            reason: 'token_expired'
        });
        
        if (guildId) {
            params.set('guildId', guildId);
        }
        
        window.location.href = `/auth/discord?${params.toString()}`;
    }
    
    // Request elevated permissions
    requestPermissions(requiredScopes, guildId = null) {
        const params = new URLSearchParams({
            scope: 'full',
            permissions: requiredScopes.join(',')
        });
        
        if (guildId) {
            params.set('guildId', guildId);
        }
        
        window.location.href = `/auth/discord?${params.toString()}`;
    }
    
    // Handle API responses that require higher permissions
    async handleApiResponse(response) {
        if (response.status === 403) {
            const errorData = await response.json();
            
            if (errorData.missing_scopes) {
                const userConfirmed = confirm(
                    `This action requires additional permissions: ${errorData.missing_scopes.join(', ')}\n\n` +
                    'Would you like to grant these permissions now?'
                );
                
                if (userConfirmed) {
                    window.location.href = errorData.reauth_url;
                }
                return false;
            }
        }
        
        return response.ok;
    }
    
    // Update UI based on token status
    updateTokenStatus(status) {
        const statusIndicators = document.querySelectorAll('.token-status');
        statusIndicators.forEach(indicator => {
            indicator.textContent = status;
            indicator.className = `token-status ${status}`;
        });
    }
    
    // Get authentication URL with specific parameters
    getAuthURL(options = {}) {
        const {
            scope = 'basic',
            guildId = null,
            permissions = null,
            forcePrompt = false
        } = options;
        
        const params = new URLSearchParams({ scope });
        
        if (guildId) params.set('guildId', guildId);
        if (permissions) params.set('permissions', permissions);
        if (forcePrompt) params.set('prompt', 'consent');
        
        return `/auth/discord?${params.toString()}`;
    }
}

// Initialize OAuth2 client
const oauth2Client = new DiscordOAuth2Client();

// Expose globally for use in other scripts
window.DiscordOAuth2Client = DiscordOAuth2Client;
window.oauth2Client = oauth2Client;
