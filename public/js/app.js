const socket = io(); function openComposer() { document.getElementById('composer').classList.add('show'); } function closeComposer() { document.getElementById('composer').classList.remove('show'); }
document.getElementById('postForm')?.addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target); const r = await fetch('/posts', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fd) }); if (r.ok) location.reload(); else alert((await r.json()).error || 'Could not publish'); });
async function offerHelp(id, b) { b.disabled = true; const r = await fetch('/help/' + id, { method: 'POST' }); const j = await r.json(); if (!r.ok) { alert(j.error); b.disabled = false; return; } b.textContent = '✓ Offer sent'; }
async function acceptHelp(id, button) {
    button.disabled = true;

    const r = await fetch('/help/' + id + '/accept', {
        method: 'POST'
    });

    const j = await r.json();

    if (!r.ok) {
        alert(j.error || 'Could not accept help');
        button.disabled = false;
        return;
    }

    location.reload();
}

async function completeHelp(id, button) {
    if (!confirm('Mark this help request as completed?')) return;

    button.disabled = true;

    const r = await fetch('/help/' + id + '/complete', {
        method: 'POST'
    });

    const j = await r.json();

    if (!r.ok) {
        alert(j.error || 'Could not complete help');
        button.disabled = false;
        return;
    }

    location.reload();
}

async function cancelHelp(id, button) {
    if (!confirm('Change the helper? The current helper will be cancelled.')) {
        return;
    }

    button.disabled = true;

    const r = await fetch('/help/' + id + '/cancel', {
        method: 'POST'
    });

    const j = await r.json();

    if (!r.ok) {
        alert(j.error || 'Could not change helper');
        button.disabled = false;
        return;
    }

    location.reload();
}

function toggleAI() { document.getElementById('aiPanel').classList.toggle('show'); } document.getElementById('aiForm')?.addEventListener('submit', async e => { e.preventDefault(); const i = document.getElementById('aiInput'), q = i.value.trim(); if (!q) return; const box = document.getElementById('aiMessages'); box.insertAdjacentHTML('beforeend', `<div class="ai-msg me"></div>`); box.lastElementChild.textContent = q; i.value = ''; const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q }) }); const j = await r.json(); const d = document.createElement('div'); d.className = 'ai-msg'; d.textContent = j.reply; box.appendChild(d); box.scrollTop = box.scrollHeight; });
async function badges() { try { const r = await fetch('/api/unread'); if (!r.ok) return; const j = await r.json(); document.getElementById('chatDot')?.style.setProperty('display', j.chats ? 'block' : 'none'); document.getElementById('notifDot')?.style.setProperty('display', j.notifications ? 'block' : 'none'); } catch { } } badges(); setInterval(badges, 3000); socket.on('chatPing', () => { document.getElementById('chatDot')?.style.setProperty('display', 'block'); }); socket.on('helpUpdate', () => { document.getElementById('notifDot')?.style.setProperty('display', 'block'); });

socket.on('helpNotification', () => { document.getElementById('notifDot')?.style.setProperty('display', 'block'); }); socket.on('newPost', p => { const feed = document.getElementById('feed'); if (!feed) return; if (document.querySelector(`[data-id=\"${p._id}\"]`)) return; const el = document.createElement('article'); el.className = 'post'; el.dataset.id = p._id; el.innerHTML = `<div class=\"post-head\"><span class=\"avatar\">${(p.user.name || 'S')[0].toUpperCase()}</span><div><b class=\"user-name\">${p.user.name}</b><div class=\"muted tiny\">${p.user.department || 'Student'} · ${p.user.year || 'Campus'} · just now</div></div><span class=\"tag\">${p.type}</span></div><p class=\"post-text\">${p.content}</p><div class=\"post-actions\"><button class=\"help-btn\" onclick=\"offerHelp('${p._id}',this)\">🤝 Help</button></div>`; feed.prepend(el); });
async function rateHelp(helpId, score, button) {
    const ratingBox = button.closest('.rating-stars');
    const stars = ratingBox.querySelectorAll('.star-btn');

    // Show selected stars immediately
    stars.forEach(star => {
        const value = Number(star.dataset.star);

        if (value <= score) {
            star.classList.add('filled');
        } else {
            star.classList.remove('filled');
        }

        star.disabled = true;
    });

    // Keep the selected rating visible
    ratingBox.dataset.rating = score;
    ratingBox.dataset.canRate = 'false';

    try {
        const response = await fetch('/help/' + helpId + '/rate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                score: score
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || 'Could not submit rating.'
            );
        }

        console.log('Rating submitted successfully.');

    } catch (error) {
        console.error('RATING ERROR:', error);

        alert(error.message);

        // Re-enable stars if request failed
        stars.forEach(star => {
            star.disabled = false;
        });

        ratingBox.dataset.canRate = 'true';
    }
}


// Rating hover and click behavior
document.querySelectorAll('.rating-stars').forEach(ratingBox => {
    const stars = [
        ...ratingBox.querySelectorAll('.star-btn')
    ];

    const existingRating = Number(
        ratingBox.dataset.rating || 0
    );

    const canRate = ratingBox.dataset.canRate === 'true';

    // Already-rated stars stay yellow and cannot be changed
    if (!canRate || existingRating) {
        return;
    }

    // Hover over any star
    ratingBox.addEventListener('mouseover', event => {
        const hoveredStar = event.target.closest('.star-btn');

        if (!hoveredStar) return;

        const selectedScore = Number(
            hoveredStar.dataset.star
        );

        stars.forEach(star => {
            const value = Number(star.dataset.star);

            star.classList.toggle(
                'filled',
                value <= selectedScore
            );
        });
    });

    ratingBox.addEventListener('mouseleave', () => {
        // Do not clear stars after a rating has been selected
        if (ratingBox.dataset.canRate === 'false') {
            return;
        }

        stars.forEach(star => {
            star.classList.remove('filled');
        });
    });

    // Click a star to submit the rating
    stars.forEach(star => {
        star.addEventListener('click', () => {
            const helpId = ratingBox.dataset.helpId;
            const score = Number(star.dataset.star);

            rateHelp(helpId, score, star);
        });
    });
});

document.addEventListener('click', e => {
    const menuButton = e.target.closest('.post-menu-btn');

    if (menuButton) {
        const menu = menuButton.closest('.post-menu');

        document.querySelectorAll('.post-menu.show').forEach(m => {
            if (m !== menu) m.classList.remove('show');
        });

        menu.classList.toggle('show');
        return;
    }

    if (!e.target.closest('.post-menu')) {
        document.querySelectorAll('.post-menu.show').forEach(m => {
            m.classList.remove('show');
        });
    }
});

async function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post?')) {
        return;
    }

    const response = await fetch('/posts/' + postId, {
        method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.error || 'Could not delete post');
        return;
    }

    document.getElementById('post-' + postId)?.remove();
}

function editPost(postId) {
    const post = document.getElementById('post-' + postId);
    if (!post) return;

    const textElement = post.querySelector('.post-text');
    if (!textElement) return;

    const currentText = textElement.textContent.trim();

    textElement.innerHTML = `
        <textarea class="post-edit-input">${currentText}</textarea>
        <div class="post-edit-actions">
            <button type="button" class="post-edit-cancel"
                onclick="cancelEditPost('${postId}')">
                Cancel
            </button>
            <button type="button" class="post-edit-save"
                onclick="saveEditedPost('${postId}')">
                Save
            </button>
        </div>
    `;

    textElement.querySelector('textarea').focus();
}

function cancelEditPost(postId) {
    location.reload();
}

async function saveEditedPost(postId) {
    const post = document.getElementById('post-' + postId);
    if (!post) return;

    const textarea = post.querySelector('.post-edit-input');
    if (!textarea) return;

    const content = textarea.value.trim();

    if (!content) {
        alert('Post cannot be empty');
        return;
    }

    const saveButton = post.querySelector('.post-edit-save');
    if (saveButton) saveButton.disabled = true;

    try {
        const response = await fetch('/posts/' + postId, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || 'Could not update post');
            if (saveButton) saveButton.disabled = false;
            return;
        }

        const textElement = post.querySelector('.post-text');

        textElement.textContent = data.content;
    } catch (error) {
        console.error('EDIT POST ERROR:', error);
        alert('Could not update post.');
        if (saveButton) saveButton.disabled = false;
    }
}

async function updatePost(postId, content) {
    const response = await fetch('/posts/' + postId, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.error || 'Could not update post');
        return;
    }

    const post = document.getElementById('post-' + postId);
    const textElement = post?.querySelector('.post-text');

    if (textElement) {
        textElement.textContent = data.content;
    }
}