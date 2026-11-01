'use strict';

// Copy buttons, the menu on small screens and the search. The site reads without any of it.

(function() {

	const root = document.documentElement.getAttribute('data-root') || './';
	document.documentElement.classList.add('js');

	// A button on every block of code, and on the command of the home page
	document.querySelectorAll('.code, [data-copy]').forEach(function(block) {

		const source = block.hasAttribute('data-copy') ? block.getAttribute('data-copy') : null;
		const button = document.createElement('button');

		button.type = 'button';
		button.className = 'copy';
		button.textContent = 'Copy';
		button.setAttribute('aria-label', 'Copy to the clipboard');

		button.addEventListener('click', function() {
			const text = source !== null ? source : block.querySelector('code').textContent;
			const done = function() {
				button.textContent = 'Copied';
				setTimeout(function() { button.textContent = 'Copy'; }, 1600);
			};
			if (navigator.clipboard)
				navigator.clipboard.writeText(text).then(done, function() {});
		});

		block.appendChild(button);
	});

	const toggle = document.querySelector('.menu-toggle');
	const sidebar = document.getElementById('sidebar');

	if (toggle && sidebar) {
		toggle.addEventListener('click', function() {
			const open = sidebar.classList.toggle('open');
			toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
		});
	}

	const input = document.getElementById('search');
	const list = document.getElementById('results');

	if (!input || !list)
		return;

	let index = null;
	let loading = false;

	function load(callback) {
		if (index)
			return callback();
		if (loading)
			return;
		loading = true;
		fetch(root + 'search.json').then(function(response) { return response.json(); }).then(function(data) {
			index = data;
			callback();
		}).catch(function() { loading = false; });
	}

	function find(query) {

		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const found = [];

		index.forEach(function(entry) {

			const heading = entry.h.toLowerCase();
			const text = entry.x.toLowerCase();
			const page = entry.t.toLowerCase();
			let score = 0;

			for (let i = 0; i < words.length; i++) {
				const word = words[i];
				if (heading.indexOf(word) !== -1)
					score += 10;
				else if (page.indexOf(word) !== -1)
					score += 4;
				else if (text.indexOf(word) !== -1)
					score += 1;
				else
					return;
			}

			found.push({ entry: entry, score: score });
		});

		found.sort(function(a, b) { return b.score - a.score; });
		return found.slice(0, 8);
	}

	function show() {

		const query = input.value.trim();

		if (query.length < 2) {
			list.hidden = true;
			return;
		}

		load(function() {

			const found = find(query);

			list.textContent = '';

			if (!found.length) {
				const none = document.createElement('li');
				none.className = 'none';
				none.textContent = 'Nothing found';
				list.appendChild(none);
			}

			found.forEach(function(item) {
				const li = document.createElement('li');
				const a = document.createElement('a');
				const title = document.createElement('strong');
				const where = document.createElement('span');
				a.href = root + item.entry.u;
				title.textContent = item.entry.h;
				where.textContent = item.entry.t;
				a.appendChild(title);
				a.appendChild(where);
				li.appendChild(a);
				list.appendChild(li);
			});

			list.hidden = false;
		});
	}

	input.addEventListener('input', show);
	input.addEventListener('focus', show);

	input.addEventListener('keydown', function(e) {
		if (e.key === 'Escape') {
			list.hidden = true;
			input.blur();
		} else if (e.key === 'Enter') {
			const first = list.querySelector('a');
			if (first)
				location.href = first.href;
		}
	});

	document.addEventListener('click', function(e) {
		if (!e.target.closest('.search'))
			list.hidden = true;
	});

	// "/" jumps to the search, like on most documentation sites
	document.addEventListener('keydown', function(e) {
		if (e.key === '/' && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
			e.preventDefault();
			input.focus();
		}
	});

})();
