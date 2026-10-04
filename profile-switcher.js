const profileRoutes = {
  guide: "guide.html",
  ambulance: "driver.html",
  patient: "index.html"
};

const profileSwitcher = document.getElementById("profileSwitcher");

if (profileSwitcher) {
  const currentUrl = new URL(window.location.href);
  const currentProfile = currentUrl.pathname.endsWith("/guide.html")
    ? "guide"
    : currentUrl.pathname.endsWith("/driver.html")
      ? "ambulance"
      : localStorage.getItem("dispatchRole") || "patient";

  profileSwitcher.value = profileRoutes[currentProfile] ? currentProfile : "patient";
  if (currentProfile !== "guide") localStorage.setItem("dispatchRole", profileSwitcher.value);

  profileSwitcher.addEventListener("change", () => {
    const selectedProfile = profileSwitcher.value;
    const destination = profileRoutes[selectedProfile];
    if (!destination) return;

    if (selectedProfile !== "guide") localStorage.setItem("dispatchRole", selectedProfile);
    window.location.href = destination;
  });
}
