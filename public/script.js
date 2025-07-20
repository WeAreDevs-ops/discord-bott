
// Mobile menu toggle
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
});

// Close mobile menu when clicking on a link
document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    });
});

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Tab functionality for commands section
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');
        
        // Remove active class from all buttons and panes
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabPanes.forEach(pane => pane.classList.remove('active'));
        
        // Add active class to clicked button and corresponding pane
        button.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
    });
});

// Animated counter for stats
function animateCounter(element, target, duration = 2000) {
    const start = 0;
    const increment = target / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target.toLocaleString();
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current).toLocaleString();
        }
    }, 16);
}

// Intersection Observer for animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            
            // Animate counters when stats section is visible
            if (entry.target.classList.contains('stats')) {
                const statNumbers = entry.target.querySelectorAll('.stat-number');
                statNumbers.forEach(stat => {
                    const target = parseInt(stat.getAttribute('data-target'));
                    animateCounter(stat, target);
                });
            }
        }
    });
}, observerOptions);

// Add fade-in animation to sections
document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('section');
    sections.forEach(section => {
        section.classList.add('fade-in');
        observer.observe(section);
    });
    
    // Add slide-in animations to feature cards
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
        card.classList.add('fade-in');
        observer.observe(card);
    });
    
    // Add slide-in animations to command cards
    const commandCards = document.querySelectorAll('.command-card');
    commandCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
        card.classList.add('fade-in');
        observer.observe(card);
    });
});

// Navbar background on scroll
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 100) {
        navbar.style.background = 'rgba(44, 47, 51, 0.98)';
    } else {
        navbar.style.background = 'rgba(44, 47, 51, 0.95)';
    }
});

// Dynamic bot stats (you can connect this to your actual bot API)
async function updateBotStats() {
    try {
        // Replace with your actual API endpoint
        const response = await fetch('/api/bot-stats');
        const data = await response.json();
        
        // Update stat numbers
        if (data.servers) {
            document.querySelector('[data-target="150"]').setAttribute('data-target', data.servers);
        }
        if (data.users) {
            document.querySelector('[data-target="25000"]').setAttribute('data-target', data.users);
        }
        if (data.commands) {
            document.querySelector('[data-target="500000"]').setAttribute('data-target', data.commands);
        }
        if (data.uptime) {
            document.querySelector('[data-target="99"]').setAttribute('data-target', Math.floor(data.uptime));
        }
    } catch (error) {
        console.log('Could not fetch real-time stats, using default values');
    }
}

// Update stats on page load
updateBotStats();

// Discord embed preview animation
const discordWindow = document.querySelector('.discord-window');
if (discordWindow) {
    discordWindow.addEventListener('mouseenter', () => {
        discordWindow.style.transform = 'rotateY(-5deg) rotateX(2deg) scale(1.02)';
    });
    
    discordWindow.addEventListener('mouseleave', () => {
        discordWindow.style.transform = 'rotateY(-15deg) rotateX(5deg) scale(1)';
    });
}

// Add typing effect to hero title
function typeWriter(element, text, speed = 100) {
    let i = 0;
    element.innerHTML = '';
    
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// Initialize typing effect on page load
document.addEventListener('DOMContentLoaded', () => {
    const heroTitle = document.querySelector('.hero-content h1');
    if (heroTitle) {
        const originalText = heroTitle.textContent;
        setTimeout(() => {
            typeWriter(heroTitle, originalText, 50);
        }, 500);
    }
});

// Copy invite link functionality (if you want to add a copy button)
function copyInviteLink() {
    const inviteUrl = 'https://discord.com/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=8&scope=bot%20applications.commands';
    navigator.clipboard.writeText(inviteUrl).then(() => {
        // Show success message
        const button = event.target;
        const originalText = button.innerHTML;
        button.innerHTML = '<i class="fas fa-check"></i> Copied!';
        button.style.background = 'var(--gradient-secondary)';
        
        setTimeout(() => {
            button.innerHTML = originalText;
            button.style.background = 'var(--gradient-primary)';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy invite link: ', err);
    });
}

// Add particle effect to hero section
function createParticles() {
    const hero = document.querySelector('.hero');
    const particleCount = 50;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'absolute';
        particle.style.width = '2px';
        particle.style.height = '2px';
        particle.style.background = 'rgba(88, 101, 242, 0.3)';
        particle.style.borderRadius = '50%';
        particle.style.pointerEvents = 'none';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.animation = `float ${3 + Math.random() * 4}s ease-in-out infinite`;
        particle.style.animationDelay = Math.random() * 2 + 's';
        
        hero.appendChild(particle);
    }
}

// Add CSS for particle animation
const style = document.createElement('style');
style.textContent = `
    @keyframes float {
        0%, 100% { transform: translateY(0px) translateX(0px); opacity: 0.3; }
        25% { transform: translateY(-10px) translateX(5px); opacity: 0.6; }
        50% { transform: translateY(-5px) translateX(-5px); opacity: 1; }
        75% { transform: translateY(-15px) translateX(3px); opacity: 0.6; }
    }
`;
document.head.appendChild(style);

// Initialize particles
createParticles();

// Add progress bar for page loading
window.addEventListener('load', () => {
    const loader = document.createElement('div');
    loader.style.position = 'fixed';
    loader.style.top = '0';
    loader.style.left = '0';
    loader.style.width = '100%';
    loader.style.height = '3px';
    loader.style.background = 'var(--gradient-primary)';
    loader.style.zIndex = '9999';
    loader.style.animation = 'loadingBar 0.5s ease-out';
    
    document.body.appendChild(loader);
    
    setTimeout(() => {
        loader.remove();
    }, 500);
});

// Add loading bar animation
const loadingStyle = document.createElement('style');
loadingStyle.textContent = `
    @keyframes loadingBar {
        0% { transform: scaleX(0); transform-origin: left; }
        100% { transform: scaleX(1); transform-origin: left; }
    }
`;
document.head.appendChild(loadingStyle);
