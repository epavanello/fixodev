<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="flex min-h-screen flex-col justify-around">
	<header class="container mx-auto flex items-center justify-between px-6 py-8">
		<h1 class="text-primary text-3xl font-bold">FixO</h1>
		<nav class="space-x-6">
			<a
				href="https://github.com/epavanello/fixodev"
				class="border-surface hover:bg-surface glow rounded-lg border px-4 py-2 transition"
				>GitHub</a
			>
			<a
				href="https://github.com/epavanello/fixodev"
				class="bg-primary text-background glow rounded-lg px-4 py-2 transition hover:opacity-90"
				>Star</a
			>
		</nav>
	</header>

	{@render children()}

	<footer class="bg-surface py-6">
		<div class="container mx-auto px-6 text-center text-sm text-gray-500">
			&copy; 2025 FixO • Open Source • Free for public repos (usage limits apply)
		</div>
	</footer>
</div>
