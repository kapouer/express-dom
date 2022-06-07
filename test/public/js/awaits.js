(async function () {
	await syncFn();
})();

const fnf = () => { };
fnf.yes = true;

Promise.resolve(3).then(() => {
	window.toto = 2;
}).catch(fnf);
const list = [];
for (let i = 0; i < 1000; i++) {
	list.push(Promise.resolve().then(async () => {
		await one();// one() is called immediately but
		// this runs in a next microtask
		const res = await fetch('js/tracker.json?t=' + Date.now(), {
			headers: { accept: 'application/json' }
		});
		const obj = await res.json();
		return obj;
	}));
}
Promise.all(list).then(([obj]) => {
	document.querySelector('.me').textContent = obj.test;
});

function syncFn() {
	window.toto = 1;
}

async function one() {
	const p = new Promise(resolve => {
		resolve();
	});
	await p;
	return true;
}
