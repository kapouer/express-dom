function req(url) {
	return window.fetch(url).then(res => {
		if (res.status == 200) return res.json();
		else if (res.status >= 400) throw new Error(res.status);
		else return {};
	});
}

function myfetch(url) {
	return req(url);
}

async function build() {
	const list = ["js/big.json"];
	const sels = [".me"];
	await Promise.all(sels.map(async sel => {
		await Promise.all(list.map(async url => {
			const data = await myfetch(url);
			document.querySelector(sel).textContent = data.test;
		}));
	}));
}

document.addEventListener('DOMContentLoaded', () => {
	build();
});
