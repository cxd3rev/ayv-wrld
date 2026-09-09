// ========================================
// ELEMENTS
// ========================================

const navbar = document.getElementById("navbar");
const mainLogo = document.getElementById("mainLogo");
const skillsBox = document.querySelector(".skills-box");


// ========================================
// NAVBAR CURSOR MOVEMENT
// Only reacts when cursor is over navbar
// ========================================

navbar.addEventListener("mousemove", function(event) {

    const rect = navbar.getBoundingClientRect();

    const mouseX = event.clientX;
    const mouseY = event.clientY;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const relativeX =
        (mouseX - centerX) / (rect.width / 2);

    const relativeY =
        (mouseY - centerY) / (rect.height / 2);

    const x =
        Math.max(-1, Math.min(1, relativeX));

    const y =
        Math.max(-1, Math.min(1, relativeY));

    const rotateY = x * -7;
    const rotateX = y * 5;

    navbar.style.transform = `
        perspective(1200px)
        rotateX(${rotateX}deg)
        rotateY(${rotateY}deg)
        translateZ(0px)
    `;

});


navbar.addEventListener("mouseleave", function() {

    navbar.style.transform = `
        perspective(1200px)
        rotateX(0deg)
        rotateY(0deg)
        translateZ(0px)
    `;

});


// ========================================
// MAIN LOGO + SKILLS BOX CURSOR MOVEMENT
// ========================================

document.addEventListener("mousemove", function(event) {

    const mouseX = event.clientX;
    const mouseY = event.clientY;


    // ====================================
    // MAIN LOGO
    // ====================================

    const logoRect = mainLogo.getBoundingClientRect();

    const logoCenterX =
        logoRect.left + logoRect.width / 2;

    const logoCenterY =
        logoRect.top + logoRect.height / 2;

    const logoDistanceX =
        mouseX - logoCenterX;

    const logoDistanceY =
        mouseY - logoCenterY;

    const logoDistance =
        Math.sqrt(
            logoDistanceX * logoDistanceX +
            logoDistanceY * logoDistanceY
        );

    const logoInfluenceRadius = 200;


    if (logoDistance < logoInfluenceRadius) {

        const logoRelativeX =
            (mouseX - logoCenterX) /
            (logoRect.width / 2);

        const logoRelativeY =
            (mouseY - logoCenterY) /
            (logoRect.height / 2);

        const logoX =
            Math.max(-1, Math.min(1, logoRelativeX));

        const logoY =
            Math.max(-1, Math.min(1, logoRelativeY));

        const logoRotateY =
            logoX * -15;

        const logoRotateX =
            logoY * 15;

        mainLogo.style.setProperty(
            "--tilt-x",
            `${logoRotateX}deg`
        );

        mainLogo.style.setProperty(
            "--tilt-y",
            `${logoRotateY}deg`
        );

    } else {

        mainLogo.style.setProperty(
            "--tilt-x",
            "0deg"
        );

        mainLogo.style.setProperty(
            "--tilt-y",
            "0deg"
        );

    }


    // ====================================
    // SKILLS BOX
    // Same movement as logo
    // NO SPIN
    // ====================================

    const boxRect = skillsBox.getBoundingClientRect();

    const boxCenterX =
        boxRect.left + boxRect.width / 2;

    const boxCenterY =
        boxRect.top + boxRect.height / 2;

    const boxDistanceX =
        mouseX - boxCenterX;

    const boxDistanceY =
        mouseY - boxCenterY;

    const boxDistance =
        Math.sqrt(
            boxDistanceX * boxDistanceX +
            boxDistanceY * boxDistanceY
        );

    const boxInfluenceRadius = 200;


    if (boxDistance < boxInfluenceRadius) {

        const boxRelativeX =
            (mouseX - boxCenterX) /
            (boxRect.width / 2);

        const boxRelativeY =
            (mouseY - boxCenterY) /
            (boxRect.height / 2);

        const boxX =
            Math.max(-1, Math.min(1, boxRelativeX));

        const boxY =
            Math.max(-1, Math.min(1, boxRelativeY));

        const boxRotateY =
            boxX * -15;

        const boxRotateX =
            boxY * 15;

        skillsBox.style.transform = `
            perspective(1200px)
            rotateX(${boxRotateX}deg)
            rotateY(${boxRotateY}deg)
        `;

    } else {

        skillsBox.style.transform = `
            perspective(1200px)
            rotateX(0deg)
            rotateY(0deg)
        `;

    }

});


// ========================================
// MAIN LOGO CLICK SPIN
// ========================================

let currentSpin = 0;
let isSpinning = false;


mainLogo.addEventListener("click", function() {

    if (isSpinning) {
        return;
    }

    isSpinning = true;

    const startSpin = currentSpin;
    const endSpin = currentSpin + 360;

    const duration = 500;
    const startTime = performance.now();


    function spin(currentTime) {

        const elapsed =
            currentTime - startTime;

        const progress =
            Math.min(elapsed / duration, 1);

        const eased =
            1 - Math.pow(1 - progress, 3);

        currentSpin =
            startSpin +
            (endSpin - startSpin) * eased;

        mainLogo.style.setProperty(
            "--spin",
            `${currentSpin}deg`
        );


        if (progress < 1) {

            requestAnimationFrame(spin);

        } else {

            currentSpin = endSpin;

            mainLogo.style.setProperty(
                "--spin",
                `${currentSpin}deg`
            );

            isSpinning = false;

        }

    }


    requestAnimationFrame(spin);

});